from __future__ import annotations

import argparse
import http.server
import json
import os
import queue
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path
from typing import Any


DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 19777
DEFAULT_MODEL = "gpt-5.4-mini"
REWRITE_SCHEMA = {
    "type": "object",
    "properties": {
        "content": {
            "type": "string",
        },
    },
    "required": ["content"],
    "additionalProperties": False,
}
BASE_INSTRUCTIONS = """You rewrite web assets for direct browser use.

Return a JSON object only.
The object must contain a string field named "content".
The content value must be the complete rewritten asset body, not a diff.
Do not wrap the result in markdown fences.
Preserve URLs, forms, selectors, public APIs, and load-bearing scripts unless they are clearly ad or tracking related."""


class CodexBridgeError(RuntimeError):
    pass


class CodexAppServerSession:
    def __init__(self, *, codex_bin: str, model: str, cwd: Path, timeout_seconds: int) -> None:
        self.codex_bin = codex_bin
        self.model = model
        self.cwd = cwd
        self.timeout_seconds = timeout_seconds
        self.next_id = 1
        self.stdout_queue: queue.Queue[dict[str, Any] | Exception] = queue.Queue()
        self.process = subprocess.Popen(
            [self.codex_bin, "app-server", "--listen", "stdio://"],
            cwd=str(self.cwd),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
        threading.Thread(target=self._read_stdout, daemon=True).start()
        threading.Thread(target=self._drain_stderr, daemon=True).start()

    def close(self) -> None:
        if self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=5)

    def rewrite(self, messages: list[dict[str, Any]]) -> str:
        deadline = time.monotonic() + self.timeout_seconds
        self._initialize(deadline)
        thread_id = self._start_thread(deadline)
        return self._start_turn(thread_id, messages, deadline)

    def _initialize(self, deadline: float) -> None:
        request_id = self._send(
            "initialize",
            {
                "clientInfo": {
                    "name": "zappa_rewrite_bridge",
                    "title": "Zappa Rewrite Bridge",
                    "version": "0.1.0",
                },
            },
        )
        self._read_response(request_id, deadline)
        self._send_notification("initialized", {})

    def _start_thread(self, deadline: float) -> str:
        request_id = self._send(
            "thread/start",
            {
                "model": self.model,
                "cwd": str(self.cwd),
                "approvalPolicy": "never",
                "sandbox": "read-only",
                "baseInstructions": BASE_INSTRUCTIONS,
                "ephemeral": True,
                "personality": "none",
                "serviceName": "zappa_rewrite_bridge",
            },
        )
        response = self._read_response(request_id, deadline)
        thread = response.get("thread") if isinstance(response, dict) else None
        thread_id = thread.get("id") if isinstance(thread, dict) else None
        if not isinstance(thread_id, str) or not thread_id:
            raise CodexBridgeError(f"Codex app-server did not return a thread id: {response!r}")
        return thread_id

    def _start_turn(self, thread_id: str, messages: list[dict[str, Any]], deadline: float) -> str:
        prompt = build_codex_prompt(messages)
        request_id = self._send(
            "turn/start",
            {
                "threadId": thread_id,
                "model": self.model,
                "input": [
                    {
                        "type": "text",
                        "text": prompt,
                    }
                ],
                "approvalPolicy": "never",
                "sandbox": "read-only",
                "outputSchema": REWRITE_SCHEMA,
            },
        )
        self._read_response(request_id, deadline)

        deltas: list[str] = []
        completed_agent_message = ""
        while True:
            message = self._read_message(deadline)
            if "id" in message and "method" in message:
                self._handle_server_request(message)
                continue

            method = message.get("method")
            params = message.get("params") if isinstance(message.get("params"), dict) else {}
            if method == "item/agentMessage/delta":
                delta = params.get("delta")
                if isinstance(delta, str):
                    deltas.append(delta)
                continue

            if method == "item/completed":
                item = params.get("item") if isinstance(params.get("item"), dict) else {}
                if item.get("type") == "agentMessage" and isinstance(item.get("text"), str):
                    completed_agent_message = item["text"]
                continue

            if method == "turn/completed":
                content = completed_agent_message or "".join(deltas)
                if not content.strip():
                    raise CodexBridgeError("Codex app-server completed without assistant content")
                return content

            if method == "error":
                raise CodexBridgeError(f"Codex app-server error notification: {params!r}")

    def _send(self, method: str, params: dict[str, Any]) -> int:
        request_id = self.next_id
        self.next_id += 1
        self._write_json({"id": request_id, "method": method, "params": params})
        return request_id

    def _send_notification(self, method: str, params: dict[str, Any]) -> None:
        self._write_json({"method": method, "params": params})

    def _write_json(self, payload: dict[str, Any]) -> None:
        if self.process.stdin is None:
            raise CodexBridgeError("Codex app-server stdin is closed")
        self.process.stdin.write(json.dumps(payload, separators=(",", ":")) + "\n")
        self.process.stdin.flush()

    def _read_response(self, request_id: int, deadline: float) -> dict[str, Any]:
        while True:
            message = self._read_message(deadline)
            if message.get("id") != request_id:
                if "id" in message and "method" in message:
                    self._handle_server_request(message)
                continue
            if "error" in message:
                raise CodexBridgeError(f"Codex app-server request failed: {message['error']!r}")
            result = message.get("result")
            return result if isinstance(result, dict) else {}

    def _read_message(self, deadline: float) -> dict[str, Any]:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise CodexBridgeError("timed out waiting for Codex app-server")
        try:
            item = self.stdout_queue.get(timeout=remaining)
        except queue.Empty as exc:
            raise CodexBridgeError("timed out waiting for Codex app-server") from exc
        if isinstance(item, Exception):
            raise CodexBridgeError(str(item)) from item
        return item

    def _handle_server_request(self, message: dict[str, Any]) -> None:
        request_id = message.get("id")
        method = message.get("method")
        if not isinstance(request_id, int):
            return
        if method == "item/commandExecution/requestApproval":
            self._write_json({"id": request_id, "result": {"decision": "cancel"}})
        elif method == "item/fileChange/requestApproval":
            self._write_json({"id": request_id, "result": {"decision": "cancel"}})
        elif method == "item/tool/requestUserInput":
            self._write_json({"id": request_id, "result": {"answers": {}}})
        else:
            self._write_json({"id": request_id, "error": {"code": -32601, "message": "unsupported request"}})

    def _read_stdout(self) -> None:
        assert self.process.stdout is not None
        for line in self.process.stdout:
            if not line.strip():
                continue
            try:
                self.stdout_queue.put(json.loads(line))
            except json.JSONDecodeError as exc:
                self.stdout_queue.put(CodexBridgeError(f"invalid Codex app-server JSON: {line!r}"))
                self.stdout_queue.put(exc)
                return

    def _drain_stderr(self) -> None:
        assert self.process.stderr is not None
        for line in self.process.stderr:
            sys.stderr.write(f"[codex-app-server] {line}")


def build_codex_prompt(messages: list[dict[str, Any]]) -> str:
    lines = [
        "Rewrite the asset according to these messages.",
        "Return only the final JSON object matching this schema:",
        json.dumps(REWRITE_SCHEMA, separators=(",", ":")),
    ]
    for message in messages:
        role = str(message.get("role", "user")).upper()
        content = message.get("content", "")
        if not isinstance(content, str):
            content = json.dumps(content, ensure_ascii=False)
        lines.append(f"\n{role}:\n{content}")
    return "\n".join(lines)


def find_codex_bin(configured: str | None) -> str:
    if configured:
        return configured
    if os.environ.get("CODEX_BIN"):
        return os.environ["CODEX_BIN"]
    discovered = shutil.which("codex")
    if discovered:
        return discovered
    mac_homebrew = Path("/opt/homebrew/bin/codex")
    if mac_homebrew.exists():
        return str(mac_homebrew)
    raise CodexBridgeError("could not find codex; set CODEX_BIN or pass --codex-bin")


def make_handler(*, codex_bin: str, default_model: str, cwd: Path, timeout_seconds: int):
    class CodexBridgeHandler(http.server.BaseHTTPRequestHandler):
        def do_OPTIONS(self) -> None:  # noqa: N802
            self._send_empty(204)

        def do_GET(self) -> None:  # noqa: N802
            if self.path in {"/healthz", "/readyz"}:
                self._send_json(200, {"status": "ok"})
                return
            self._send_json(404, {"error": "not found"})

        def do_POST(self) -> None:  # noqa: N802
            if self.path not in {"/chat/completions", "/v1/chat/completions"}:
                self._send_json(404, {"error": "not found"})
                return
            try:
                payload = self._read_json()
                messages = payload.get("messages")
                if not isinstance(messages, list):
                    raise CodexBridgeError("request must contain a messages array")
                model = payload.get("model") if isinstance(payload.get("model"), str) else default_model
                content = run_codex_rewrite(
                    codex_bin=codex_bin,
                    model=model or default_model,
                    cwd=cwd,
                    timeout_seconds=timeout_seconds,
                    messages=messages,
                )
                self._send_json(200, build_chat_completion_response(model or default_model, content))
            except Exception as error:  # noqa: BLE001
                self._send_json(500, {"error": str(error)})

        def log_message(self, format: str, *args: object) -> None:  # noqa: A003
            sys.stderr.write(f"[codex-bridge] {self.address_string()} - {format % args}\n")

        def _read_json(self) -> dict[str, Any]:
            content_length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(content_length)
            parsed = json.loads(raw.decode("utf-8"))
            if not isinstance(parsed, dict):
                raise CodexBridgeError("request body must be a JSON object")
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

    return CodexBridgeHandler


def run_codex_rewrite(
    *,
    codex_bin: str,
    model: str,
    cwd: Path,
    timeout_seconds: int,
    messages: list[dict[str, Any]],
) -> str:
    session = CodexAppServerSession(
        codex_bin=codex_bin,
        model=model,
        cwd=cwd,
        timeout_seconds=timeout_seconds,
    )
    try:
        return session.rewrite(messages)
    finally:
        session.close()


def build_chat_completion_response(model: str, content: str) -> dict[str, Any]:
    return {
        "id": f"chatcmpl-codex-{int(time.time() * 1000)}",
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
    parser = argparse.ArgumentParser(description="OpenAI-compatible bridge for Codex app-server.")
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", default=DEFAULT_PORT, type=int)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--codex-bin")
    parser.add_argument("--cwd", default=tempfile.gettempdir())
    parser.add_argument("--timeout-seconds", default=180, type=int)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    codex_bin = find_codex_bin(args.codex_bin)
    cwd = Path(args.cwd).expanduser().resolve()
    handler = make_handler(
        codex_bin=codex_bin,
        default_model=args.model,
        cwd=cwd,
        timeout_seconds=args.timeout_seconds,
    )
    server = ThreadingHTTPServer((args.host, args.port), handler)
    print(f"Codex bridge listening on http://{args.host}:{args.port}")
    print(f"Using codex binary: {codex_bin}")
    print(f"Default model: {args.model}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
