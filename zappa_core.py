from __future__ import annotations

import html
import json
import os
import re
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any


HTML_MIME_TYPES = {"text/html", "application/xhtml+xml"}
CSS_MIME_TYPES = {"text/css"}
JAVASCRIPT_MIME_TYPES = {
    "application/ecmascript",
    "application/javascript",
    "application/x-ecmascript",
    "application/x-javascript",
    "text/ecmascript",
    "text/javascript",
}
CONTENT_TYPE_BY_KIND = {
    "html": "text/html; charset=utf-8",
    "css": "text/css; charset=utf-8",
    "javascript": "application/javascript; charset=utf-8",
}
INTEGRITY_ATTR_RE = re.compile(r"""\s+integrity\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)""", re.I)

SYSTEM_PROMPT = """You rewrite web assets for direct browser use.

Goals:
- Remove ads, popups, autoplay, bright distracting visual clutter, nag screens, and attention traps.
- Preserve the page's core information architecture and functionality as much as possible.
- Keep all URLs, forms, selectors, public APIs, and load-bearing scripts valid unless they are clearly ad or tracking related.
- Return syntactically valid output for the requested asset kind.
- Do not wrap the result in markdown fences.

Output rules:
- Return a JSON object only.
- The object must contain a string field named "content".
- "content" must be the complete rewritten asset body, not a diff or explanation.
"""


@dataclass(slots=True)
class TransformResult:
    content: str
    model: str
    latency_ms: int
    raw_response: str


def normalize_content_type(content_type: str) -> str:
    return content_type.split(";", 1)[0].strip().lower()


def detect_asset_kind(content_type: str, path: str) -> str | None:
    normalized = normalize_content_type(content_type)
    lower_path = path.lower()

    if normalized in HTML_MIME_TYPES or lower_path.endswith((".html", ".htm", "/")):
        return "html"
    if normalized in CSS_MIME_TYPES or lower_path.endswith(".css"):
        return "css"
    if normalized in JAVASCRIPT_MIME_TYPES or lower_path.endswith((".js", ".mjs", ".cjs")):
        return "javascript"
    return None


def sanitize_rewritten_asset(asset_kind: str, content: str) -> str:
    if asset_kind == "html":
        return INTEGRITY_ATTR_RE.sub("", content)
    return content


def build_error_body(asset_kind: str, message: str) -> str:
    if asset_kind == "html":
        escaped = html.escape(message)
        return (
            "<!doctype html>"
            "<html><head><meta charset='utf-8'><title>zappa proxy error</title></head>"
            "<body style='font-family: monospace; padding: 2rem;'>"
            "<h1>zappa proxy error</h1>"
            f"<pre style='white-space: pre-wrap;'>{escaped}</pre>"
            "</body></html>"
        )
    if asset_kind == "css":
        return f"/* zappa proxy error: {message} */"
    if asset_kind == "javascript":
        return f"throw new Error({json.dumps('zappa proxy error: ' + message)});"
    return message


def extract_json_object(raw_text: str) -> dict[str, Any]:
    try:
        parsed = json.loads(raw_text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", raw_text, re.S)
        if not match:
            raise ValueError("model did not return JSON") from None
        parsed = json.loads(match.group(0))

    if not isinstance(parsed, dict):
        raise ValueError("model returned JSON that was not an object")
    return parsed


class CerebrasTransformer:
    def __init__(
        self,
        *,
        api_key: str | None,
        base_url: str,
        model: str,
        timeout_seconds: int,
        max_input_chars: int,
        max_completion_tokens: int,
    ) -> None:
        self.api_key = api_key or os.getenv("CEREBRAS_API_KEY")
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout_seconds = timeout_seconds
        self.max_input_chars = max_input_chars
        self.max_completion_tokens = max_completion_tokens

    def transform(
        self,
        *,
        url: str,
        asset_kind: str,
        content_type: str,
        source: str,
    ) -> TransformResult:
        if not self.api_key:
            raise RuntimeError("missing Cerebras API key; set CEREBRAS_API_KEY or zappa_api_key")
        if len(source) > self.max_input_chars:
            raise RuntimeError(
                f"asset too large for zappa_max_input_chars ({len(source)} > {self.max_input_chars})"
            )

        request_payload = {
            "model": self.model,
            "temperature": 0.1,
            "max_completion_tokens": self.max_completion_tokens,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": json.dumps(
                        {
                            "url": url,
                            "asset_kind": asset_kind,
                            "content_type": content_type,
                            "source": source,
                        },
                        ensure_ascii=False,
                    ),
                },
            ],
        }

        body = json.dumps(request_payload).encode("utf-8")
        request = urllib.request.Request(
            url=f"{self.base_url}/chat/completions",
            data=body,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )

        started = time.time()
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                raw_response = response.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            error_body = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Cerebras HTTP {exc.code}: {error_body}") from exc
        except urllib.error.URLError as exc:
            raise RuntimeError(f"Cerebras request failed: {exc.reason}") from exc

        payload = extract_json_object(raw_response)
        choices = payload.get("choices")
        if not isinstance(choices, list) or not choices:
            raise RuntimeError("Cerebras response did not include choices")

        message = choices[0].get("message", {})
        if not isinstance(message, dict):
            raise RuntimeError("Cerebras response contained an invalid message payload")

        content = message.get("content", "")
        if not isinstance(content, str) or not content.strip():
            raise RuntimeError("Cerebras response did not include assistant content")

        transformed_payload = extract_json_object(content)
        transformed_content = (
            transformed_payload.get("content")
            or transformed_payload.get("rewritten")
            or transformed_payload.get("body")
        )
        if not isinstance(transformed_content, str) or not transformed_content:
            raise RuntimeError("model JSON did not contain a non-empty content field")

        return TransformResult(
            content=transformed_content,
            model=self.model,
            latency_ms=int((time.time() - started) * 1000),
            raw_response=raw_response,
        )
