# Backends

## Current backend

Pi with the Codex provider is the primary backend path.

The Firefox extension calls:

- `POST {baseUrl}/chat/completions`

The local bridge at `tools/pi_codex_bridge.py` exposes that HTTP shape and translates each rewrite into an ephemeral Pi run:

1. run `pi --mode json --no-session --no-tools --provider openai-codex`
2. collect Pi JSON text events from stdout
3. normalize the model output into `{"content":"..."}`
4. return an OpenAI-compatible chat-completions response

Default extension settings:

- Backend: `Pi + Codex bridge`
- Base URL: `http://127.0.0.1:19777`
- Model: `gpt-5.4-mini`

For another machine on Tailscale to use a workstation bridge, run:

```bash
ZAPPA_BRIDGE_API_KEY=change-me python3 tools/pi_codex_bridge.py --host 0.0.0.0
```

Then point the extension at the workstation's Tailscale DNS name or IP on port `19777` and put the same value in the extension's `API Key` field.

## Compatibility backend

The `openai_compatible` mode remains available for hosted or local servers that already expose `POST /chat/completions`.

## Output contract

The model must return JSON with this shape:

```json
{
  "content": "complete rewritten asset body"
}
```

The browser extension parses that JSON and swaps the original HTML response with `content`.
