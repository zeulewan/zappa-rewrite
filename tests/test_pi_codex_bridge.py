from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace


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

    def test_preserves_markdown_format_and_title(self) -> None:
        self.assertEqual(
            pi_codex_bridge.normalize_model_output('{"format":"markdown","title":"OK","content":"# OK"}'),
            '{"content": "# OK", "format": "markdown", "title": "OK"}',
        )

    def test_wraps_raw_html(self) -> None:
        self.assertEqual(
            pi_codex_bridge.normalize_model_output("<main>OK</main>"),
            '{"format": "markdown", "content": "<main>OK</main>"}',
        )

    def test_strips_markdown_fence(self) -> None:
        self.assertEqual(
            pi_codex_bridge.normalize_model_output('```json\n{"content":"OK"}\n```'),
            '{"content": "OK"}',
        )


class RunPiRewriteTests(unittest.TestCase):
    def test_passes_prompt_by_file_and_cleans_up(self) -> None:
        large_source = "x" * 200_000
        messages = [
            {"role": "user", "content": json.dumps({"asset_kind": "html", "source": large_source})},
        ]
        seen_prompt_path: Path | None = None

        def fake_run(command, **kwargs):  # type: ignore[no-untyped-def]
            nonlocal seen_prompt_path
            prompt_arg = command[-1]
            self.assertIsInstance(prompt_arg, str)
            self.assertTrue(prompt_arg.startswith("@"))
            self.assertNotIn(large_source, command)

            seen_prompt_path = Path(prompt_arg[1:])
            self.assertTrue(seen_prompt_path.exists())
            self.assertIn(large_source, seen_prompt_path.read_text(encoding="utf-8"))
            return SimpleNamespace(
                returncode=0,
                stdout=json.dumps(
                    {
                        "type": "message_update",
                        "assistantMessageEvent": {
                            "type": "text_delta",
                            "delta": '{"content":"OK"}',
                        },
                    }
                ),
                stderr="",
            )

        original_run = pi_codex_bridge.subprocess.run
        pi_codex_bridge.subprocess.run = fake_run
        try:
            with tempfile.TemporaryDirectory() as tmp:
                result = pi_codex_bridge.run_pi_rewrite(
                    pi_bin="pi",
                    provider="openai-codex",
                    model="gpt-5.4-mini",
                    thinking="minimal",
                    cwd=Path(tmp),
                    timeout_seconds=10,
                    messages=messages,
                )
        finally:
            pi_codex_bridge.subprocess.run = original_run

        self.assertEqual(result, '{"content": "OK"}')
        self.assertIsNotNone(seen_prompt_path)
        self.assertFalse(seen_prompt_path.exists())


if __name__ == "__main__":
    unittest.main()
