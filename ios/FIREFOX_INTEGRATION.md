# Firefox iOS Integration Notes

Current upstream clone path:

```text
.worktrees/firefox-ios
```

Useful Firefox iOS files found in the current upstream checkout:

- Main browser controller:
  `.worktrees/firefox-ios/firefox-ios/Client/Frontend/Browser/BrowserViewController/Views/BrowserViewController.swift`
- Browser controller action/menu extension:
  `.worktrees/firefox-ios/firefox-ios/Client/Frontend/Browser/BrowserViewController/Extensions/BrowserViewController+ToolBarActionMenuDelegate.swift`
- Selected tab webview access:
  `.worktrees/firefox-ios/firefox-ios/Client/TabManagement/Tab.swift`
  exposes `currentWebView() -> WKWebView?`.
- Existing summarize integration to mirror:
  `.worktrees/firefox-ios/firefox-ios/Client/Frontend/Summarizer/`

Minimal first hook:

```swift
import ZappaRewriteKit

private lazy var zappaCoordinator = ZappaRewriteCoordinator {
    ZappaConfig(
        isEnabled: true,
        allowedHosts: ["www.theguardian.com", "www.wired.com"],
        apiKey: "<local token>"
    )
}

func zappaRewriteSelectedTab() {
    guard let webView = tabManager.selectedTab?.currentWebView() else { return }
    zappaCoordinator.rewriteCurrentPage(from: webView, presenter: self)
}
```

That gives us a working modal reader first. After that, we can move it into Firefox's toolbar/menu state system and replace the hardcoded config with settings storage.

