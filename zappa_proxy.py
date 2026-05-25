from __future__ import annotations

import json
from pathlib import Path

from mitmproxy import ctx
from mitmproxy import http
from mitmproxy.addonmanager import Loader

from zappa_core import CONTENT_TYPE_BY_KIND
from zappa_core import CerebrasTransformer
from zappa_core import build_error_body
from zappa_core import detect_asset_kind
from zappa_core import sanitize_rewritten_asset


class ZappaProxy:
    def load(self, loader: Loader) -> None:
        loader.add_option("zappa_enabled", bool, True, "Rewrite HTML, CSS, and JS through Cerebras.")
        loader.add_option("zappa_api_key", str, "", "Cerebras API key. Falls back to CEREBRAS_API_KEY.")
        loader.add_option("zappa_base_url", str, "https://api.cerebras.ai/v1", "Cerebras API base URL.")
        loader.add_option("zappa_model", str, "qwen-3-32b", "Cerebras model to use for rewriting.")
        loader.add_option("zappa_timeout_seconds", int, 90, "Timeout for a single LLM rewrite request.")
        loader.add_option(
            "zappa_max_input_chars",
            int,
            120000,
            "Hard cap for a single asset body. Oversized assets return an explicit proxy error.",
        )
        loader.add_option(
            "zappa_max_completion_tokens",
            int,
            16000,
            "Maximum completion tokens requested from Cerebras for each rewrite.",
        )
        loader.add_option("zappa_log_path", str, "zappa.log.jsonl", "Where rewrite logs should be written.")
        loader.add_option("zappa_log_bodies", bool, True, "Whether to log original and rewritten asset bodies.")

    def response(self, flow: http.HTTPFlow) -> None:
        if not ctx.options.zappa_enabled or not flow.response:
            return
        if flow.metadata.get("zappa_processed"):
            return
        if flow.response.status_code < 200 or flow.response.status_code >= 300:
            return

        asset_kind = detect_asset_kind(
            flow.response.headers.get("content-type", ""),
            flow.request.path,
        )
        if not asset_kind:
            return

        if not flow.response.raw_content:
            return

        try:
            flow.response.decode()
        except ValueError:
            pass

        original_text = flow.response.get_text(strict=False)
        if not original_text.strip():
            return

        transformer = CerebrasTransformer(
            api_key=ctx.options.zappa_api_key or None,
            base_url=ctx.options.zappa_base_url,
            model=ctx.options.zappa_model,
            timeout_seconds=ctx.options.zappa_timeout_seconds,
            max_input_chars=ctx.options.zappa_max_input_chars,
            max_completion_tokens=ctx.options.zappa_max_completion_tokens,
        )

        log_record = {
            "url": flow.request.pretty_url,
            "method": flow.request.method,
            "asset_kind": asset_kind,
            "request_headers": dict(flow.request.headers),
            "response_headers": dict(flow.response.headers),
            "status_code": flow.response.status_code,
            "input_chars": len(original_text),
        }

        try:
            result = transformer.transform(
                url=flow.request.pretty_url,
                asset_kind=asset_kind,
                content_type=flow.response.headers.get("content-type", ""),
                source=original_text,
            )
        except Exception as exc:
            error_message = str(exc)
            self._write_log(
                {
                    **log_record,
                    "ok": False,
                    "error": error_message,
                    "original": original_text if ctx.options.zappa_log_bodies else None,
                }
            )
            self._replace_with_error(flow, asset_kind, error_message)
            return

        rewritten_text = sanitize_rewritten_asset(asset_kind, result.content)
        flow.response.set_text(rewritten_text)
        flow.response.headers["content-type"] = CONTENT_TYPE_BY_KIND[asset_kind]
        flow.response.headers["cache-control"] = "no-store"
        flow.response.headers["x-zappa-model"] = result.model
        flow.response.headers["x-zappa-transform"] = "rewritten"

        for header_name in (
            "content-encoding",
            "content-length",
            "content-security-policy",
            "content-security-policy-report-only",
            "etag",
            "last-modified",
            "report-to",
            "transfer-encoding",
            "x-webkit-csp",
        ):
            if header_name in flow.response.headers:
                del flow.response.headers[header_name]

        flow.metadata["zappa_processed"] = True
        self._write_log(
            {
                **log_record,
                "ok": True,
                "model": result.model,
                "latency_ms": result.latency_ms,
                "output_chars": len(rewritten_text),
                "original": original_text if ctx.options.zappa_log_bodies else None,
                "rewritten": rewritten_text if ctx.options.zappa_log_bodies else None,
            }
        )

    def _replace_with_error(self, flow: http.HTTPFlow, asset_kind: str, message: str) -> None:
        flow.response = http.Response.make(
            502,
            build_error_body(asset_kind, message).encode("utf-8"),
            {
                "Content-Type": CONTENT_TYPE_BY_KIND.get(asset_kind, "text/plain; charset=utf-8"),
                "Cache-Control": "no-store",
                "X-Zappa-Transform": "error",
            },
        )
        flow.metadata["zappa_processed"] = True

    def _write_log(self, record: dict[str, object]) -> None:
        log_path = Path(ctx.options.zappa_log_path).expanduser()
        log_path.parent.mkdir(parents=True, exist_ok=True)
        with log_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")


addons = [ZappaProxy()]
