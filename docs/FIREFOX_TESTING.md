# Firefox Testing

## What was tested on this workstation

The extension was tested against the locally installed Firefox on this machine.

Verified:

- Firefox exists on the workstation
- the extension installs as a temporary add-on
- the extension can rewrite a test page
- the extension honors the global enable toggle
- the extension honors the per-site disabled-host list

## Why the automated test uses a mock backend

The smoke test is intended to verify extension mechanics, not model quality.

That means the test focuses on:

- Firefox launch
- extension installation
- network interception
- response rewriting
- storage-backed settings changes

Using a mock backend makes the result:

- deterministic
- fast
- independent of Ollama setup
- independent of model quality or timeout behavior

## Test harness

The harness lives at:

- `tools/firefox_extension_smoke_test.py`

It does the following:

1. starts a local mock Ollama-compatible server on `127.0.0.1:11434`
2. starts a local test site on `127.0.0.1:18080`
3. packages the extension into a temporary `.xpi`
4. launches Firefox through Selenium and geckodriver
5. installs the add-on temporarily
6. reads Firefox's extension UUID mapping
7. verifies:
   - rewrite-on behavior
   - global disable behavior
   - per-site disable behavior

## Running the smoke test

```bash
python3 -m venv .venv
.venv/bin/pip install selenium
.venv/bin/python tools/firefox_extension_smoke_test.py
```

## Headful vs headless

Default behavior is headless.

To run in a visible desktop session:

```bash
ZAPPA_FIREFOX_HEADFUL=1 .venv/bin/python tools/firefox_extension_smoke_test.py
```

That is useful when debugging browser-side behavior interactively.

## Important Firefox-specific constraints discovered

### MV3 service worker issue

Firefox on this workstation rejected the initial MV3 temporary add-on install path because the `background.service_worker` configuration was not accepted for this automation path.

That is why the current extension uses `manifest_version: 2` with `background.scripts`.

### Chrome-context access issue

Reading Firefox's internal extension UUID mapping required launching Firefox with:

```text
-remote-allow-system-access
```

Without that flag, Selenium's chrome-context access was blocked.

## What is not covered by the smoke test

- visual correctness of the popup UI
- real Ollama latency and failure modes
- live-site correctness
- script-heavy sites with complex CSP or framework bundling
- model quality under long asset bodies

## Suggested next tests

- run against a real Ollama backend
- automate popup UI clicks directly
- add assertions for stylesheet and script rewrites, not just the HTML marker
- add failure-path tests where the backend returns invalid JSON or a timeout
