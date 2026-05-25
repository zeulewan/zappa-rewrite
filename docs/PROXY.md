# Proxy Prototype

## Purpose

The proxy implementation is the original experimental branch of the idea.

It exists for:

- traffic interception outside Firefox
- prompt experimentation outside extension APIs
- comparing browser-native vs proxy-native rewriting

## Files

- `zappa_proxy.py`
- `zappa_core.py`
- `tests/test_zappa_core.py`

## Current behavior

The proxy code:

- detects HTML, CSS, and JavaScript responses
- sends full asset text to Cerebras
- expects structured JSON output from the model
- rewrites the response body
- emits a proxy-side error response when rewriting fails
- logs flows to JSONL

## Important difference from the extension

The proxy code currently still assumes Cerebras.

It does not yet share the extension's backend abstraction or local-first backend defaults.

## Basic usage

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install mitmproxy
export CEREBRAS_API_KEY=your_key_here
mitmdump -s zappa_proxy.py
```

## Why it is not the main path now

The Firefox extension is a better immediate target because:

- it does not require system proxy setup
- it does not require MITM certificate installation
- it is easier to distribute as a browser-specific experiment
- it matches the user's current direction better

## Future choices

There are two reasonable futures for the proxy code:

- keep it as an experimental sidecar
- refactor it to share backend adapters and prompt contracts with the extension
