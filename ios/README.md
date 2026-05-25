# Zappa iOS

Firefox iOS is the base. Keep Mozilla's source in a separate worktree and apply Zappa as a small overlay so upstream rebases stay possible.

Bootstrap:

```sh
ios/scripts/bootstrap-firefox-ios.sh
```

The first iOS target is a Firefox-based browser shell with:

- a Zappa toggle in browser chrome
- allowlisted hosts
- DOM capture from the active `WKWebView`
- streaming rewrite calls to the existing Pi/Codex bridge
- a static reader view generated from model Markdown

Default bridge URL for Tailscale dev:

```text
https://workstation.tailee9084.ts.net:19777
```

