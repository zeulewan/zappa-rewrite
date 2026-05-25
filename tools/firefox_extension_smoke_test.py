from __future__ import annotations

import contextlib
import http.server
import json
import os
import socketserver
import tempfile
import threading
import zipfile
from pathlib import Path

from selenium import webdriver
from selenium.common.exceptions import TimeoutException
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.support.ui import WebDriverWait


ROOT = Path(__file__).resolve().parents[1]
EXTENSION_DIR = ROOT / "firefox-extension"
SITE_PORT = 18080
BACKEND_PORT = 19778
SITE_URL = f"http://127.0.0.1:{SITE_PORT}/"
ADDON_ID = "zappa-rewrite@nova.local"
TEST_SITE_BODY = """<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>zappa smoke test</title>
    <style>.tracking { color: red; }</style>
    <script>window.shouldNotReachModel = true;</script>
  </head>
  <body class="theme-shell" data-build-id="abc123">
    <!-- this comment should be removed before the model sees the page -->
    <header class="site-banner"><nav><a href="/one">one</a></nav></header>
    <main id="content" class="layout" data-page-kind="article">
      <article class="story-card" data-testid="story">
        <h1 id="marker" class="headline">ORIGINAL PAGE</h1>
        <figure class="media-wrap" data-component="hero">
          <img
            class="hero-image"
            data-src="/images/hero-large.jpg"
            src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="
            srcset="/images/hero-small.jpg 320w, /images/hero-large.jpg 960w"
            width="960"
            height="540"
            alt="A useful hero image">
          <figcaption class="caption">Useful image caption.</figcaption>
        </figure>
        <p data-track="copy">Useful article text survives the reducer.</p>
      </article>
    </main>
    <aside class="sponsored-widget">ad clutter</aside>
    <footer class="site-footer">footer clutter</footer>
  </body>
</html>
"""
FIREFOX_BINARY_CANDIDATES = [
    Path("/snap/firefox/current/usr/lib/firefox/firefox"),
    Path("/snap/firefox/8191/usr/lib/firefox/firefox"),
    Path("/snap/firefox/8107/usr/lib/firefox/firefox"),
    Path("/usr/lib/firefox/firefox"),
]


class ThreadingTCPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True


class TestSiteHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/" or self.path.startswith("/index"):
            self._write_response(200, "text/html; charset=utf-8", TEST_SITE_BODY)
            return
        self._write_response(404, "text/plain; charset=utf-8", "not found")

    def log_message(self, format: str, *args: object) -> None:  # noqa: A003
        return

    def _write_response(self, status: int, content_type: str, body: str) -> None:
        encoded = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)


class MockPiBridgeHandler(http.server.BaseHTTPRequestHandler):
    last_source = ""

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/chat/completions":
            self._write_json(404, {"error": "not found"})
            return

        content_length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(content_length)
        payload = json.loads(raw.decode("utf-8"))
        user_content = payload["messages"][-1]["content"]
        request_data = json.loads(user_content)
        asset_kind = request_data["asset_kind"]
        source = request_data["source"]

        if asset_kind != "html":
            self._write_json(400, {"error": f"unexpected asset kind: {asset_kind}"})
            return

        type(self).last_source = source
        rewritten = """# REWRITTEN PAGE

<figure>
  <img src="http://127.0.0.1:18080/images/hero-large.jpg" width="960" height="540" alt="A useful hero image">
  <figcaption>Useful image caption.</figcaption>
</figure>

Useful article text survives the reducer.

- One useful bullet
- Another useful bullet
"""

        self._write_json(
            200,
            {
                "model": payload.get("model", "mock"),
                "choices": [
                    {
                        "index": 0,
                        "message": {
                            "role": "assistant",
                            "content": json.dumps(
                                {
                                    "format": "markdown",
                                    "title": "Rewritten smoke test",
                                    "content": rewritten,
                                }
                            ),
                        },
                        "finish_reason": "stop",
                    }
                ],
            },
        )

    def log_message(self, format: str, *args: object) -> None:  # noqa: A003
        return

    def _write_json(self, status: int, body: dict[str, object]) -> None:
        encoded = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)


@contextlib.contextmanager
def run_server(handler: type[http.server.BaseHTTPRequestHandler], port: int):
    server = ThreadingTCPServer(("127.0.0.1", port), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def build_xpi(target_dir: Path) -> Path:
    xpi_path = target_dir / "zappa-rewrite.xpi"
    with zipfile.ZipFile(xpi_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in EXTENSION_DIR.rglob("*"):
            if path.is_file():
                if path.name == "dev-settings.json":
                    continue
                archive.write(path, path.relative_to(EXTENSION_DIR))
    return xpi_path


def wait_for_condition(driver: webdriver.Firefox, predicate, timeout: int = 10) -> None:
    WebDriverWait(driver, timeout).until(lambda _: predicate())


def read_extension_uuid(driver: webdriver.Firefox) -> str:
    driver.set_context("chrome")
    try:
        mapping_raw = driver.execute_script(
            """
                return Services.prefs.getStringPref('extensions.webextensions.uuids');
            """
        )
    finally:
        driver.set_context("content")

    mapping = json.loads(mapping_raw)
    extension_uuid = mapping.get(ADDON_ID)
    if not extension_uuid:
        raise RuntimeError("could not find extension UUID in Firefox prefs")
    return extension_uuid


def set_extension_storage(driver: webdriver.Firefox, extension_uuid: str, values: dict[str, object]) -> None:
    driver.get(f"moz-extension://{extension_uuid}/popup.html")
    script = """
        const values = arguments[0];
        const done = arguments[arguments.length - 1];
        browser.storage.local.set(values).then(() => done("ok"), error => done(`error:${error.message}`));
    """
    result = driver.execute_async_script(script, values)
    if result != "ok":
        raise RuntimeError(f"failed to update extension storage: {result}")


def get_extension_storage(driver: webdriver.Firefox, extension_uuid: str, key: str) -> object:
    driver.get(f"moz-extension://{extension_uuid}/popup.html")
    script = """
        const key = arguments[0];
        const done = arguments[arguments.length - 1];
        browser.storage.local.get(key).then(value => done(value[key]), error => done({error: error.message}));
    """
    result = driver.execute_async_script(script, key)
    if isinstance(result, dict) and "error" in result:
        raise RuntimeError(f"failed to read extension storage: {result['error']}")
    return result


def load_site_and_read_body_text(driver: webdriver.Firefox) -> str:
    driver.get(SITE_URL)
    try:
        wait_for_condition(
            driver,
            lambda: driver.execute_script("return document.readyState") == "complete",
            timeout=10,
        )
    except TimeoutException as exc:
        raise RuntimeError("page did not finish loading") from exc
    return driver.execute_script("return document.body?.innerText || ''")


def assert_reduced_source(source: str) -> None:
    forbidden_snippets = [
        "<script",
        "<style",
        "<aside",
        "<footer",
        "class=",
        "data-",
        "srcset=",
        "shouldNotReachModel",
        "sponsored-widget",
    ]
    for snippet in forbidden_snippets:
        if snippet in source:
            raise RuntimeError(f"reduced source still contains {snippet!r}: {source[:1000]}")

    required_snippets = [
        "ORIGINAL PAGE",
        "Useful article text survives the reducer.",
        "Useful image caption.",
        "src=\"http://127.0.0.1:18080/images/hero-large.jpg\"",
        "width=\"960\"",
        "height=\"540\"",
        "alt=\"A useful hero image\"",
    ]
    for snippet in required_snippets:
        if snippet not in source:
            raise RuntimeError(f"reduced source is missing {snippet!r}: {source[:1000]}")


def main() -> None:
    print("Starting mock backend and local test site...")
    with run_server(MockPiBridgeHandler, BACKEND_PORT), run_server(TestSiteHandler, SITE_PORT):
        with tempfile.TemporaryDirectory(prefix="zappa-firefox-build-") as build_tmp:
            build_dir = Path(build_tmp)
            xpi_path = build_xpi(build_dir)
            firefox_binary = next((path for path in FIREFOX_BINARY_CANDIDATES if path.exists()), None)
            if not firefox_binary:
                raise RuntimeError("could not find a Firefox browser binary")

            options = Options()
            options.binary_location = str(firefox_binary)
            options.add_argument("-remote-allow-system-access")
            if os.environ.get("ZAPPA_FIREFOX_HEADFUL") == "1" and os.environ.get("DISPLAY"):
                options.add_argument("--new-instance")
            else:
                options.add_argument("--headless")

            driver = webdriver.Firefox(options=options)
            try:
                print("Installing temporary add-on...")
                driver.install_addon(str(xpi_path), temporary=True)
                extension_uuid = read_extension_uuid(driver)
                print(f"Extension UUID: {extension_uuid}")

                print("Verifying fresh install passes through by default...")
                body_text = load_site_and_read_body_text(driver)
                if "ORIGINAL PAGE" not in body_text:
                    raise RuntimeError(f"expected original marker before allowlist, got {body_text!r}")

                print("Verifying allowlisted site rewrites...")
                MockPiBridgeHandler.last_source = ""
                set_extension_storage(
                    driver,
                    extension_uuid,
                    {
                        "configured": True,
                        "allowedHosts": ["127.0.0.1"],
                        "baseUrl": f"http://127.0.0.1:{BACKEND_PORT}",
                    },
                )
                body_text = load_site_and_read_body_text(driver)
                if "REWRITTEN PAGE" not in body_text:
                    raise RuntimeError(f"expected rewritten marker after allowlist, got {body_text!r}")
                if not driver.execute_script("return Boolean(document.querySelector('main.zappa-reader style, style'))"):
                    raise RuntimeError("expected rendered Markdown document to include reader CSS")
                rendered_image = driver.execute_script(
                    """
                    const image = document.querySelector('main.zappa-reader img');
                    return image ? {
                      src: image.getAttribute('src'),
                      width: image.getAttribute('width'),
                      height: image.getAttribute('height'),
                      alt: image.getAttribute('alt'),
                      loading: image.getAttribute('loading'),
                      decoding: image.getAttribute('decoding')
                    } : null;
                    """
                )
                if rendered_image != {
                    "src": "http://127.0.0.1:18080/images/hero-large.jpg",
                    "width": "960",
                    "height": "540",
                    "alt": "A useful hero image",
                    "loading": "lazy",
                    "decoding": "async",
                }:
                    raise RuntimeError(f"rendered image lost sizing metadata: {rendered_image!r}")
                assert_reduced_source(MockPiBridgeHandler.last_source)
                rewrite_status = get_extension_storage(driver, extension_uuid, "rewriteStatus")
                if not isinstance(rewrite_status, dict) or rewrite_status.get("state") != "done":
                    raise RuntimeError(f"expected done rewrite status, got {rewrite_status!r}")

                print("Verifying global disable...")
                set_extension_storage(driver, extension_uuid, {"enabled": False})
                body_text = load_site_and_read_body_text(driver)
                if "ORIGINAL PAGE" not in body_text:
                    raise RuntimeError(f"expected original marker after global disable, got {body_text!r}")

                print("Verifying allowlist removal...")
                set_extension_storage(
                    driver,
                    extension_uuid,
                    {"enabled": True, "allowedHosts": []},
                )
                body_text = load_site_and_read_body_text(driver)
                if "ORIGINAL PAGE" not in body_text:
                    raise RuntimeError(f"expected original marker after allowlist removal, got {body_text!r}")

                print("Smoke test passed.")
            finally:
                driver.quit()


if __name__ == "__main__":
    main()
