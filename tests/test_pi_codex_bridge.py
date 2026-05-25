from __future__ import annotations

import importlib.util
import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BRIDGE_PATH = ROOT / "tools" / "pi_codex_bridge.py"
SPEC = importlib.util.spec_from_file_location("pi_codex_bridge", BRIDGE_PATH)
assert SPEC is not None
assert SPEC.loader is not None
pi_codex_bridge = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(pi_codex_bridge)


class ExtractPiTextTests(unittest.TestCase):
    def test_collects_text_deltas(self) -> None:
        stdout = "\n".join(
            [
                json.dumps({"type": "message_update", "assistantMessageEvent": {"type": "text_delta", "delta": '{"content":'}}),
                json.dumps({"type": "message_update", "assistantMessageEvent": {"type": "text_delta", "delta": '"OK"}'}}),
            ]
        )

        self.assertEqual(pi_codex_bridge.extract_pi_text(stdout), '{"content":"OK"}')

    def test_prefers_text_end(self) -> None:
        stdout = "\n".join(
            [
                json.dumps({"type": "message_update", "assistantMessageEvent": {"type": "text_delta", "delta": "partial"}}),
                json.dumps(
                    {
                        "type": "message_update",
                        "assistantMessageEvent": {"type": "text_end", "content": '{"content":"final"}'},
                    }
                ),
            ]
        )

        self.assertEqual(pi_codex_bridge.extract_pi_text(stdout), '{"content":"final"}')

    def test_uses_turn_end_fallback(self) -> None:
        stdout = json.dumps(
            {
                "type": "turn_end",
                "message": {
                    "role": "assistant",
                    "content": [{"type": "text", "text": '{"content":"fallback"}'}],
                },
            }
        )

        self.assertEqual(pi_codex_bridge.extract_pi_text(stdout), '{"content":"fallback"}')


class NormalizeModelOutputTests(unittest.TestCase):
    def test_preserves_content_json(self) -> None:
        self.assertEqual(
            pi_codex_bridge.normalize_model_output('{"content":"<main>OK</main>"}'),
            '{"content": "<main>OK</main>"}',
        )

    def test_wraps_raw_html(self) -> None:
        self.assertEqual(
            pi_codex_bridge.normalize_model_output("<main>OK</main>"),
            '{"content": "<main>OK</main>"}',
        )

    def test_strips_markdown_fence(self) -> None:
        self.assertEqual(
            pi_codex_bridge.normalize_model_output('```json\n{"content":"OK"}\n```'),
            '{"content": "OK"}',
        )


if __name__ == "__main__":
    unittest.main()
