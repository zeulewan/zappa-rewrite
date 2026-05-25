from __future__ import annotations

import argparse
import http.server
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any


DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 19777
DEFAULT_PROVIDER = "openai-codex"
DEFAULT_MODEL = "gpt-5.4-mini"
DEFAULT_THINKING = "minimal"
DEFAULT_TIMEOUT_SECONDS = 180

BRIDGE_SYSTEM_PROMPT = """You are the backend for a JS-free browser page rewriter.

Return one JSON object only: {"content":"..."}.
The content string must be a complete rewritten HTML response body.
Do not include markdown fences, comments about the rewrite, scripts, inline event handlers, or javascript: URLs.
Prefer semantic static HTML that preserves the source page's useful content, links, forms, and navigation.
Remove ads, popups, autoplay, nag screens, tracking widgets, and distracting clutter."""


class PiBridgeError(RuntimeError):
    pass


def find_pi_bin(configured: str | None) -> str:
    if configured:
        return configured
    if os.environ.get("PI_BIN"):
        return os.environ["PI_BIN"]
    discovered = shutil.which("pi")
    if discovered:
        return discovered
    mac_homebrew = Path("/opt/homebrew/bin/pi")
    if mac_homebrew.exists():
        return str(mac_homebrew)
    raise PiBridgeError("could not find pi; set PI_BIN or pass --pi-bin")


def build_pi_prompt(messages: list[dict[str, Any]]) -> str:
    lines = [
        "Process this browser rewrite request.",
        "Honor the latest applicable instruction from the messages.",
        "Return only the final JSON object expected by the browser extension.",
    ]
    for message in messages:
        role = str(message.get("role", "user")).upper()
        content = message.get("content", "")
        if not isinstance(content, str):
            content = json.dumps(content, ensure_ascii=False)
        lines.append(f"\n{role}:\n{content}")
    return "\n".join(lines)


def summarize_rewrite_request(messages: list[dict[str, Any]]) -> dict[str, Any]:
    for message in reversed(messages):
        if not isinstance(message, dict) or message.get("role") != "user":
            continue
        content = message.get("content")
        if not isinstance(content, str):
            continue
        try:
            parsed = json.loads(content)
        except json.JSONDecodeError:
            continue
        if not isinstance(parsed, dict):
            continue
        source = parsed.get("source")
        return {
            "url": parsed.get("url") if isinstance(parsed.get("url"), str) else "",
            "asset_kind": parsed.get("asset_kind") if isinstance(parsed.get("asset_kind"), str) else "",
            "content_type": parsed.get("content_type") if isinstance(parsed.get("content_type"), str) else "",
            "source_chars": len(source) if isinstance(source, str) else 0,
        }
    return {
        "url": "",
        "asset_kind": "",
        "content_type": "",
        "source_chars": 0,
    }


def summarize_rewrite_output(content: str) -> dict[str, int]:
    parsed = parse_json_object(content)
    if isinstance(parsed, dict) and isinstance(parsed.get("content"), str):
        return {"content_chars": len(parsed["content"])}
    return {"content_chars": len(content)}


def log_rewrite_start(client: str, model: str, summary: dict[str, Any]) -> None:
    sys.stderr.write(
        "[pi-codex-bridge] "
        f"{client} rewrite start model={model} "
        f"kind={summary['asset_kind'] or '-'} "
        f"source_chars={summary['source_chars']} "
        f"url={summary['url'] or '-'}\n"
    )
    sys.stderr.flush()


def log_rewrite_end(client: str, status: str, elapsed_seconds: float, summary: dict[str, Any]) -> None:
    fields = " ".join(f"{key}={value}" for key, value in summary.items())
    sys.stderr.write(
        "[pi-codex-bridge] "
        f"{client} rewrite {status} elapsed={elapsed_seconds:.2f}s {fields}\n"
    )
    sys.stderr.flush()


def run_pi_rewrite(
    *,
    pi_bin: str,
    provider: str,
    model: str,
    thinking: str,
    cwd: Path,
    timeout_seconds: int,
    messages: list[dict[str, Any]],
) -> str:
    prompt = build_pi_prompt(messages)
    prompt_path = write_prompt_file(prompt, cwd)
    try:
        command = [
            pi_bin,
            "--mode",
            "json",
            "--print",
            "--no-session",
            "--no-tools",
            "--no-extensions",
            "--no-skills",
            "--no-context-files",
            "--provider",
            provider,
            "--model",
            model,
            "--thinking",
            thinking,
            "--system-prompt",
            BRIDGE_SYSTEM_PROMPT,
            f"@{prompt_path}",
        ]
        env = os.environ.copy()
        env.setdefault("PI_TELEMETRY", "0")
        try:
            completed = subprocess.run(
                command,
                cwd=str(cwd),
                env=env,
                capture_output=True,
                text=True,
                timeout=timeout_seconds,
                check=False,
            )
        except subprocess.TimeoutExpired as exc:
            raise PiBridgeError(f"pi timed out after {timeout_seconds}s") from exc

        if completed.returncode != 0:
            stderr = completed.stderr.strip() or completed.stdout.strip()
            raise PiBridgeError(f"pi exited with {completed.returncode}: {stderr[-2000:]}")

        assistant_text = extract_pi_text(completed.stdout)
        return normalize_model_output(assistant_text)
    finally:
        try:
            prompt_path.unlink()
        except OSError:
            pass


def write_prompt_file(prompt: str, cwd: Path) -> Path:
    cwd.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        "w",
        encoding="utf-8",
        prefix="zappa-pi-prompt-",
        suffix=".txt",
        dir=str(cwd),
        delete=False,
    ) as prompt_file:
        prompt_file.write(prompt)
        return Path(prompt_file.name)


def extract_pi_text(stdout: str) -> str:
    deltas: list[str] = []
    text_end = ""
    fallback = ""

    for line in stdout.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        try:
            event = json.loads(stripped)
        except json.JSONDecodeError as exc:
            raise PiBridgeError(f"pi emitted invalid JSON: {stripped[:200]!r}") from exc

        assistant_event = event.get("assistantMessageEvent")
        if isinstance(assistant_event, dict):
            event_type = assistant_event.get("type")
            if event_type == "text_delta" and isinstance(assistant_event.get("delta"), str):
                deltas.append(assistant_event["delta"])
            elif event_type == "text_end" and isinstance(assistant_event.get("content"), str):
                text_end = assistant_event["content"]

        if event.get("type") in {"message_end", "turn_end"}:
            message_text = extract_text_from_message(event.get("message"))
            if message_text:
                fallback = message_text

        if event.get("type") == "agent_end":
            messages = event.get("messages")
            if isinstance(messages, list):
                for message in reversed(messages):
                    if isinstance(message, dict) and message.get("role") == "assistant":
                        message_text = extract_text_from_message(message)
                        if message_text:
                            fallback = message_text
                            break

    content = text_end or "".join(deltas) or fallback
    if not content.strip():
        raise PiBridgeError("pi completed without assistant text")
    return content


def extract_text_from_message(message: Any) -> str:
    if not isinstance(message, dict):
        return ""
    content = message.get("content")
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    parts: list[str] = []
    for item in content:
        if isinstance(item, dict) and item.get("type") == "text" and isinstance(item.get("text"), str):
            parts.append(item["text"])
    return "".join(parts)


def normalize_model_output(text: str) -> str:
    stripped = strip_markdown_fence(text.strip())
    if not stripped:
        raise PiBridgeError("model returned empty content")

    parsed = parse_json_object(stripped)
    if isinstance(parsed, dict) and isinstance(parsed.get("content"), str):
        return json.dumps({"content": parsed["content"]}, ensure_ascii=False)

    return json.dumps({"content": stripped}, ensure_ascii=False)


def strip_markdown_fence(text: str) -> str:
    match = re.fullmatch(r"```(?:json|html)?\s*([\s\S]*?)\s*```", text)
    return match.group(1).strip() if match else text


def parse_json_object(text: str) -> Any:
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{[\s\S]*\}", text)
        if not match:
            return None
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            return None


def make_handler(
    *,
    pi_bin: str,
    provider: str,
    default_model: str,
    thinking: str,
    cwd: Path,
    timeout_seconds: int,
    api_key: str,
):
    class PiCodexBridgeHandler(http.server.BaseHTTPRequestHandler):
        def do_OPTIONS(self) -> None:  # noqa: N802
            self._send_empty(204)

        def do_GET(self) -> None:  # noqa: N802
            if self.path in {"/healthz", "/readyz"}:
                self._send_json(
                    200,
                    {
                        "status": "ok",
                        "provider": provider,
                        "model": default_model,
                    },
                )
                return
            self._send_json(404, {"error": "not found"})

        def do_POST(self) -> None:  # noqa: N802
            if self.path not in {"/chat/completions", "/v1/chat/completions"}:
                self._send_json(404, {"error": "not found"})
                return
            if not self._authorized():
                self._send_json(401, {"error": "unauthorized"})
                return

            try:
                payload = self._read_json()
                messages = payload.get("messages")
                if not isinstance(messages, list):
                    raise PiBridgeError("request must contain a messages array")
                model = payload.get("model") if isinstance(payload.get("model"), str) else default_model
                client = self.address_string()
                request_summary = summarize_rewrite_request(messages)
                log_rewrite_start(client, model or default_model, request_summary)
                started = time.monotonic()
                content = run_pi_rewrite(
                    pi_bin=pi_bin,
                    provider=provider,
                    model=model or default_model,
                    thinking=thinking,
                    cwd=cwd,
                    timeout_seconds=timeout_seconds,
                    messages=messages,
                )
                output_summary = summarize_rewrite_output(content)
                log_rewrite_end(
                    client,
                    "ok",
                    time.monotonic() - started,
                    {**request_summary, **output_summary},
                )
                self._send_json(200, build_chat_completion_response(model or default_model, content))
            except Exception as error:  # noqa: BLE001
                log_rewrite_end(
                    self.address_string(),
                    "error",
                    time.monotonic() - started if "started" in locals() else 0,
                    {"message": str(error)},
                )
                self._send_json(500, {"error": str(error)})

        def log_message(self, format: str, *args: object) -> None:  # noqa: A003
            sys.stderr.write(f"[pi-codex-bridge] {self.address_string()} - {format % args}\n")

        def _authorized(self) -> bool:
            if not api_key:
                return True
            return self.headers.get("Authorization", "") == f"Bearer {api_key}"

        def _read_json(self) -> dict[str, Any]:
            content_length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(content_length)
            parsed = json.loads(raw.decode("utf-8"))
            if not isinstance(parsed, dict):
                raise PiBridgeError("request body must be a JSON object")
            return parsed

        def _send_empty(self, status: int) -> None:
            self.send_response(status)
            self._send_common_headers()
            self.end_headers()

        def _send_json(self, status: int, body: dict[str, Any]) -> None:
            encoded = json.dumps(body, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self._send_common_headers()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)

        def _send_common_headers(self) -> None:
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

    return PiCodexBridgeHandler


def build_chat_completion_response(model: str, content: str) -> dict[str, Any]:
    return {
        "id": f"chatcmpl-pi-{int(time.time() * 1000)}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": model,
        "choices": [
            {
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": content,
                },
                "finish_reason": "stop",
            }
        ],
    }


class ThreadingHTTPServer(http.server.ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="OpenAI-compatible bridge for Pi + Codex.")
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", default=DEFAULT_PORT, type=int)
    parser.add_argument("--provider", default=DEFAULT_PROVIDER)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--thinking", default=DEFAULT_THINKING)
    parser.add_argument("--pi-bin")
    parser.add_argument("--cwd", default=tempfile.gettempdir())
    parser.add_argument("--timeout-seconds", default=DEFAULT_TIMEOUT_SECONDS, type=int)
    parser.add_argument("--api-key", default=os.environ.get("ZAPPA_BRIDGE_API_KEY", ""))
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    pi_bin = find_pi_bin(args.pi_bin)
    cwd = Path(args.cwd).expanduser().resolve()
    handler = make_handler(
        pi_bin=pi_bin,
        provider=args.provider,
        default_model=args.model,
        thinking=args.thinking,
        cwd=cwd,
        timeout_seconds=args.timeout_seconds,
        api_key=args.api_key,
    )
    server = ThreadingHTTPServer((args.host, args.port), handler)
    print(f"Pi Codex bridge listening on http://{args.host}:{args.port}")
    print(f"Using pi binary: {pi_bin}")
    print(f"Provider: {args.provider}")
    print(f"Default model: {args.model}")
    print(f"Thinking: {args.thinking}")
    if args.api_key:
        print("Bearer auth: enabled")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
