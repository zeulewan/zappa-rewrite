# Backends

## Goal

The project should not depend on one inference vendor.

The practical design goal is:

- local-first by default
- easy switching between local runtimes
- room for hosted APIs later

## Current extension backend modes

### `ollama`

This mode calls:

- `POST {baseUrl}/api/chat`

Expected use:

- local Ollama server
- models like `qwen3:4b` or `qwen3:8b`

Why this is the default:

- very easy local setup
- common on hobbyist machines
- good enough for first-pass experimentation

### `openai_compatible`

This mode calls:

- `POST {baseUrl}/chat/completions`

Expected use:

- LM Studio local server
- `llama.cpp` server, if exposed through a compatible layer
- `vLLM`
- `LocalAI`
- future hosted APIs

This mode is intentionally generic rather than branded around one provider.

## Local backend recommendations

### Best starting point

- Ollama
- `qwen3:4b`

This is the easiest place to start because it minimizes hardware pressure and setup complexity.

### Better quality floor

- Ollama
- `qwen3:8b`

That is a better quality baseline if the machine can support it.

### FOSS-friendly alternatives

The repo should be able to support these later through the existing `openai_compatible` shape or a small adapter:

- LM Studio
- `llama.cpp`
- `vLLM`
- `LocalAI`

## Output expectations

The model is not asked for prose. It is asked for structured output.

Expected semantic contract:

- return a JSON object
- include a `content` field
- `content` contains the complete rewritten asset

This matters because browser-side asset rewriting is fragile. A model that drifts into explanations or markdown fences is not usable here.

## Why not bundle a model in the extension

The extension is only a client and traffic hook.

Running a serious model fully inside Firefox is not the practical path because:

- model size is too large
- memory pressure would be bad
- performance would be poor
- the browser extension environment is the wrong place for heavyweight inference

The right boundary is:

- extension intercepts traffic
- local or remote inference server performs generation

## Security and privacy implications

### Local backend

Pros:

- page contents stay on your machine
- lower long-term cost
- easier experimentation

Cons:

- local hardware limits model quality and speed
- failures become your responsibility

### Hosted backend

Pros:

- stronger models are easier to access
- no local GPU requirement

Cons:

- page contents leave your machine
- latency is usually worse
- usage cost can become substantial

## Future backend work

- add backend presets in the popup
- add backend health checks
- add explicit per-backend payload adapters
- add timeout and retry controls to the extension UI
- add a small compatibility matrix in docs once multiple local runtimes are tested
