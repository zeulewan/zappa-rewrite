# Zappa Rewrite

Firefox extension experiment inspired by geohot's Zappa mitmproxy post:
https://geohot.github.io//blog/jekyll/update/2026/04/15/zappa-mitmproxy.html

Zappa Rewrite intercepts HTML pages in Firefox and asks a local Pi + Codex bridge to rewrite the response before the browser renders it.

## Status

Ready for local experiments. Not production-ready, packaged, signed, or hardened for arbitrary sites.

Verified:

- Python helper tests pass
- Firefox extension manifest is valid JSON
- A Selenium smoke test exists for installing the extension and rewriting a local test page with a mock Pi bridge backend

## Quick Start

Load the extension in Firefox:

1. Open `about:debugging#/runtime/this-firefox`
2. Click `Load Temporary Add-on...`
3. Select `firefox-extension/manifest.json`

Run the Pi + Codex bridge:

```bash
python3 tools/pi_codex_bridge.py
```

Use these extension settings:

- Backend: `Pi + Codex bridge`
- Base URL: `http://127.0.0.1:19777`
- Model: `gpt-5.4-mini`

For a Tailscale-visible bridge on the workstation:

```bash
ZAPPA_BRIDGE_API_KEY=change-me python3 tools/pi_codex_bridge.py --host 0.0.0.0
```

Put the same value in the extension's `API Key` field.

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
