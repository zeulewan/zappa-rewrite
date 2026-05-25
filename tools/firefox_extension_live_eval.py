from __future__ import annotations

import argparse
import json
import os
import tempfile
import time
from pathlib import Path
from urllib.parse import urlparse

from selenium import webdriver
from selenium.common.exceptions import TimeoutException
from selenium.webdriver.firefox.options import Options

from firefox_extension_smoke_test import EXTENSION_DIR
from firefox_extension_smoke_test import FIREFOX_BINARY_CANDIDATES
from firefox_extension_smoke_test import build_xpi
from firefox_extension_smoke_test import read_extension_uuid
from firefox_extension_smoke_test import set_extension_storage
from firefox_extension_smoke_test import wait_for_condition


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_URLS = [
    "https://www.theguardian.com/international",
    "https://www.theguardian.com/world/2026/may/25/iran-denies-deal-us-imminent-israel-oman-strait-of-hormuz",
    "https://www.wired.com/story/the-universe-is-full-of-impossible-black-holes-now-scientists-know-why/",
]
CAPTURE_SCRIPT = """
const root = arguments[0] ? document.querySelector(arguments[0]) : document;
function compact(value) {
  return String(value || '').replace(/\\s+/g, ' ').trim();
}
function absUrl(value) {
  try {
    return new URL(value, location.href).href;
  } catch (error) {
    return String(value || '');
  }
}
function linkLabel(link) {
  return compact(link.getAttribute('aria-label') || link.textContent || link.getAttribute('title') || '');
}
function visibleEnough(node) {
  const text = compact(node.textContent || node.getAttribute('aria-label') || node.getAttribute('alt') || '');
  if (!text) {
    return false;
  }
  const style = getComputedStyle(node);
  return style.display !== 'none' && style.visibility !== 'hidden';
}
const links = Array.from((root || document).querySelectorAll('a[href]'))
  .map((link, index) => ({
    index,
    text: linkLabel(link),
    href: absUrl(link.getAttribute('href')),
    inNav: Boolean(link.closest('nav, header, [role="navigation"]')),
  }))
  .filter((link) => link.text && /^https?:/.test(link.href));
const headings = Array.from((root || document).querySelectorAll('h1,h2,h3'))
  .filter(visibleEnough)
  .map((heading) => ({
    level: heading.tagName.toLowerCase(),
    text: compact(heading.textContent),
  }))
  .filter((heading) => heading.text);
const images = Array.from((root || document).querySelectorAll('img[src]'))
  .map((image) => ({
    alt: compact(image.getAttribute('alt')),
    src: absUrl(image.getAttribute('src')),
    width: image.getAttribute('width') || '',
    height: image.getAttribute('height') || '',
    complete: image.complete,
    naturalWidth: image.naturalWidth,
    naturalHeight: image.naturalHeight,
  }))
  .filter((image) => image.alt || image.naturalWidth > 0);
return {
  url: location.href,
  title: document.title,
  text: compact((root || document.body || document.documentElement).innerText || ''),
  headings,
  links,
  images,
  tableCount: (root || document).querySelectorAll('table').length,
};
"""


def load_dev_settings() -> dict[str, object]:
    path = EXTENSION_DIR / "dev-settings.json"
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run live Firefox E2E checks against the Zappa extension.")
    parser.add_argument("urls", nargs="*", default=DEFAULT_URLS)
    parser.add_argument("--backend-url", default=os.environ.get("ZAPPA_EVAL_BACKEND_URL", "http://127.0.0.1:19777"))
    parser.add_argument("--model", default=os.environ.get("ZAPPA_EVAL_MODEL", ""))
    parser.add_argument("--api-key", default=os.environ.get("ZAPPA_EVAL_API_KEY", ""))
    parser.add_argument("--timeout", type=int, default=180)
    parser.add_argument("--headful", action="store_true")
    parser.add_argument("--report-dir", default=str(ROOT / "web-ext-artifacts" / "live-eval"))
    return parser.parse_args()


def normalize_text(text: str) -> str:
    return " ".join(str(text or "").lower().split())


def contains_label(text: str, label: str) -> bool:
    normalized_label = normalize_text(label)
    if len(normalized_label) < 4:
        return True
    return normalized_label in normalize_text(text)


def dedupe_links(links: list[dict[str, object]]) -> list[dict[str, object]]:
    seen: set[tuple[str, str]] = set()
    deduped = []
    for link in links:
        key = (str(link.get("text", "")), str(link.get("href", "")))
        if key in seen:
            continue
        seen.add(key)
        deduped.append(link)
    return deduped


def important_original_links(capture: dict[str, object]) -> list[dict[str, object]]:
    links = dedupe_links([link for link in capture.get("links", []) if isinstance(link, dict)])
    nav_links = [link for link in links if link.get("inNav")]
    content_links = [link for link in links if not link.get("inNav")]
    useful_content = [
        link for link in content_links
        if len(str(link.get("text", "")).split()) >= 4 or "/2026/" in str(link.get("href", ""))
    ]
    return (nav_links[:24] + useful_content[:32])[:56]


def compare_captures(original: dict[str, object], rewritten: dict[str, object]) -> dict[str, object]:
    rewritten_links = dedupe_links([link for link in rewritten.get("links", []) if isinstance(link, dict)])
    rewritten_hrefs = {str(link.get("href", "")) for link in rewritten_links}
    rewritten_text = str(rewritten.get("text", ""))
    important_links = important_original_links(original)
    missing_hrefs = [
        link for link in important_links
        if str(link.get("href", "")) not in rewritten_hrefs
    ]
    missing_labels = [
        link for link in important_links
        if not contains_label(rewritten_text, str(link.get("text", "")))
    ]
    original_headings = [
        heading for heading in original.get("headings", [])
        if isinstance(heading, dict) and len(str(heading.get("text", "")).split()) >= 2
    ][:24]
    missing_headings = [
        heading for heading in original_headings
        if not contains_label(rewritten_text, str(heading.get("text", "")))
    ]
    broken_images = [
        image for image in rewritten.get("images", [])
        if isinstance(image, dict) and (not image.get("complete") or int(image.get("naturalWidth") or 0) <= 0)
    ]
    return {
        "important_original_links": important_links,
        "missing_hrefs": missing_hrefs,
        "missing_labels": missing_labels,
        "missing_headings": missing_headings,
        "broken_images": broken_images,
        "original_counts": {
            "links": len(original.get("links", [])),
            "headings": len(original.get("headings", [])),
            "images": len(original.get("images", [])),
        },
        "rewritten_counts": {
            "links": len(rewritten.get("links", [])),
            "headings": len(rewritten.get("headings", [])),
            "images": len(rewritten.get("images", [])),
            "tables": rewritten.get("tableCount", 0),
            "chars": len(str(rewritten.get("text", ""))),
        },
    }


def configure_extension(driver: webdriver.Firefox, extension_uuid: str, url: str, args: argparse.Namespace) -> None:
    dev_settings = load_dev_settings()
    api_key = args.api_key or str(dev_settings.get("apiKey") or "")
    model = args.model or str(dev_settings.get("model") or "gpt-5.3-codex-spark")
    host = urlparse(url).hostname or ""
    set_extension_storage(
        driver,
        extension_uuid,
        {
            "enabled": True,
            "configured": True,
            "allowedHosts": [host],
            "backend": "pi_codex",
            "baseUrl": args.backend_url,
            "model": model,
            "apiKey": api_key,
            "maxInputChars": int(dev_settings.get("maxInputChars") or 2_000_000),
            "maxOutputTokens": int(dev_settings.get("maxOutputTokens") or 32768),
        },
    )


def capture_page(driver: webdriver.Firefox, selector: str | None = None) -> dict[str, object]:
    return driver.execute_script(CAPTURE_SCRIPT, selector or "")


def evaluate_url(driver: webdriver.Firefox, extension_uuid: str, url: str, args: argparse.Namespace) -> dict[str, object]:
    set_extension_storage(driver, extension_uuid, {"enabled": False, "configured": False, "allowedHosts": []})
    driver.get(url)
    wait_for_condition(driver, lambda: driver.execute_script("return document.readyState") == "complete", timeout=45)
    time.sleep(1)
    original = capture_page(driver)

    configure_extension(driver, extension_uuid, url, args)
    started = time.monotonic()
    driver.get(url)
    wait_for_condition(
        driver,
        lambda: driver.execute_script(
            "return location.protocol === 'moz-extension:' && ['done','error'].includes(document.body.dataset.zappaState || '')"
        ),
        timeout=args.timeout,
    )
    elapsed = time.monotonic() - started
    state = driver.execute_script("return document.body.dataset.zappaState || ''")
    rewritten = capture_page(driver, "#reader-content")
    status = driver.execute_script("return document.getElementById('reader-status')?.textContent || ''")
    comparison = compare_captures(original, rewritten)
    return {
        "url": url,
        "state": state,
        "elapsed_seconds": round(elapsed, 2),
        "status": status,
        "original": original,
        "rewritten": rewritten,
        "comparison": comparison,
    }


def main() -> None:
    args = parse_args()
    report_dir = Path(args.report_dir)
    report_dir.mkdir(parents=True, exist_ok=True)
    firefox_binary = next((path for path in FIREFOX_BINARY_CANDIDATES if path.exists()), None)
    if not firefox_binary:
        raise RuntimeError("could not find a Firefox browser binary")

    with tempfile.TemporaryDirectory(prefix="zappa-live-eval-") as build_tmp:
        xpi_path = build_xpi(Path(build_tmp))
        options = Options()
        options.binary_location = str(firefox_binary)
        options.add_argument("-remote-allow-system-access")
        if args.headful and os.environ.get("DISPLAY"):
            options.add_argument("--new-instance")
        else:
            options.add_argument("--headless")
        driver = webdriver.Firefox(options=options)
        try:
            driver.set_page_load_timeout(90)
            driver.install_addon(str(xpi_path), temporary=True)
            extension_uuid = read_extension_uuid(driver)
            results = []
            for url in args.urls:
                print(f"Evaluating {url}", flush=True)
                result = evaluate_url(driver, extension_uuid, url, args)
                results.append(result)
                comparison = result["comparison"]
                print(
                    f"  state={result['state']} elapsed={result['elapsed_seconds']}s "
                    f"missing_hrefs={len(comparison['missing_hrefs'])} "
                    f"missing_labels={len(comparison['missing_labels'])} "
                    f"missing_headings={len(comparison['missing_headings'])} "
                    f"broken_images={len(comparison['broken_images'])}",
                    flush=True,
                )
            report = {
                "created_at": int(time.time()),
                "backend_url": args.backend_url,
                "urls": args.urls,
                "results": results,
            }
            report_path = report_dir / f"live-eval-{int(time.time())}.json"
            report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
            latest_path = report_dir / "latest.json"
            latest_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
            print(f"Report: {report_path}")
        finally:
            driver.quit()


if __name__ == "__main__":
    main()
