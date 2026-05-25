# Architecture

## Overview

The repository currently has two separate execution paths:

- a Firefox extension in `firefox-extension/`
- a `mitmproxy` prototype in the repository root

The Firefox extension is the main product direction. The proxy code remains as a sidecar experiment.

## Firefox extension architecture

### Main components

- `manifest.json`
  Declares permissions, popup UI, background script, and the Firefox extension ID.

- `background.js`
  Owns the network interception, response buffering, model calls, response replacement, and storage-backed settings cache.

- `popup.html`
  The popup layout and controls.

- `popup.js`
  Reads and writes `storage.local`, displays current settings, and handles per-site disabling and backend configuration.

- `popup.css`
  Styles the popup UI.

### Request flow

1. Firefox issues a request for a page or frame.
2. If the extension is configured and the site host is allowlisted, `onBeforeSendHeaders` forces `Accept-Encoding: identity`.
3. `onBeforeRequest` creates a `filterResponseData` stream filter for eligible requests.
4. The filter buffers the full response body.
5. On stream stop, the extension decodes the response body.
6. The body is sent to the configured backend.
7. The backend is expected to return JSON with a `content` field.
8. The rewritten text is written back to the response filter.
9. The extension updates response headers to remove stale or conflicting metadata.

### Eligibility logic

The current extension rewrites these request types:

- `main_frame`
- `sub_frame`

The current extension does not rewrite:

- scripts
- stylesheets
- images
- fonts
- XHR or fetch bodies
- media
- WebSocket traffic

### Settings model

The extension stores settings in `browser.storage.local`.

Current fields:

- `enabled`
- `configured`
- `allowedHosts`
- `disabledHosts`
- `backend`
- `baseUrl`
- `model`
- `apiKey`
- `maxInputChars`
- `maxOutputTokens`

`background.js` keeps an in-memory cache synchronized with storage change events so each request does not need to re-read storage.

### JavaScript-free output

The browser-side path is intentionally HTML-only. The prompt forbids scripts, and `background.js` strips script tags, inline event handlers, `javascript:` URLs, and stale integrity attributes from rewritten HTML before writing the response.

### Per-site allow behavior

Rewriting is off for every site by default. A host must be added to `allowedHosts` before any page from that site can be rewritten.

The enabled-sites list is host-based, not full-URL-based.

The extension derives the site host from:

- `documentUrl`, if present
- `originUrl`, if present
- otherwise the request URL itself

This means an allowed host permits rewriting of pages and frames that are considered part of that top-level site context.

### Rewrite output contract

The extension expects the model backend to return JSON with this shape:

```json
{
  "content": "complete rewritten asset text"
}
```

That shape is enforced by prompt instructions and parsed defensively in code.

### Header handling

After rewriting, the extension removes or overwrites some headers:

- `content-encoding`
- `content-length`
- `content-security-policy`
- `content-security-policy-report-only`
- `etag`
- `last-modified`
- `report-to`
- `transfer-encoding`
- `x-webkit-csp`

It also sets:

- `Cache-Control: no-store`
- `Content-Type` based on rewritten asset kind
- `X-Zappa-Backend`
- `X-Zappa-Transform`

This is a pragmatic anti-breakage strategy, not a clean or final policy layer.

## Proxy architecture

### Main files

- `zappa_proxy.py`
- `zappa_core.py`

### Flow

1. `mitmproxy` intercepts the response.
2. The response is decoded into text.
3. The text is sent to Cerebras.
4. The rewritten asset replaces the original.
5. The flow is logged to JSONL.

### Why it remains separate

The proxy version still hardcodes a Cerebras-oriented backend path.
The extension moved in a different direction:

- local-first inference
- backend abstraction
- Firefox-native interception

These paths should be unified later if the proxy remains important.
