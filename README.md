# Zappa Rewrite

Firefox extension experiment inspired by geohot's Zappa mitmproxy post:
https://geohot.github.io//blog/jekyll/update/2026/04/15/zappa-mitmproxy.html

Zappa Rewrite intercepts HTML, CSS, and JavaScript in Firefox and asks a local or OpenAI-compatible LLM backend to rewrite the response before the browser renders it.

## Status

Ready for local experiments. Not production-ready, packaged, signed, or hardened for arbitrary sites.

Verified:

- Python helper tests pass
- Firefox extension manifest is valid JSON
- A Selenium smoke test exists for installing the extension and rewriting a local test page with a mock Ollama backend

## Quick Start

Start Ollama:

```bash
ollama pull qwen3:4b
ollama serve
```

Load the extension in Firefox:

1. Open `about:debugging#/runtime/this-firefox`
2. Click `Load Temporary Add-on...`
3. Select `firefox-extension/manifest.json`

Run the Python tests:

```bash
python -m pytest -q
```

Run the Firefox smoke test:

```bash
python3 -m venv .venv
.venv/bin/pip install selenium
.venv/bin/python tools/firefox_extension_smoke_test.py
```
