import Common
import ObjectiveC
import OSLog
import UIKit
import WebKit

private let zappaLogger = Logger(subsystem: "ZappaRewrite", category: "FirefoxOverlay")

private enum ZappaAssociationKeys {
    nonisolated(unsafe) static let coordinator: UnsafeRawPointer = UnsafeRawPointer(bitPattern: 0x7A_61_70_70_61)!
}

private extension Notification.Name {
    static let zappaRewriteRequested = Notification.Name("ZappaRewriteRequested")
}

extension BrowserViewController {
    private enum ZappaDefaults {
        static let apiKey = "zappa_api_key"
        static let bridgeBaseURL = "zappa_bridge_base_url"
        static let model = "zappa_model"
    }

    func installZappaRewriteButton() {
        guard !AppConstants.isRunningUnitTest else {
            return
        }
        view.viewWithTag(Self.zappaRewriteButtonTag)?.removeFromSuperview()
        NotificationCenter.default.removeObserver(self, name: .zappaRewriteRequested, object: nil)
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(zappaRewriteSelectedTab),
            name: .zappaRewriteRequested,
            object: nil
        )
        zappaLogger.info("Installed Zappa toolbar rewrite handler")
    }

    func raiseZappaRewriteButton() {
        view.viewWithTag(Self.zappaRewriteButtonTag)?.removeFromSuperview()
    }

    @objc
    func zappaRewriteSelectedTab() {
        guard let webView = tabManager.selectedTab?.currentWebView(),
              let url = webView.url,
              let host = url.host?.lowercased()
        else {
            zappaLogger.error("Rewrite requested with no selected page")
            showZappaMessage("No page loaded")
            return
        }

        let defaults = UserDefaults.standard
        let apiKey = defaults.string(forKey: ZappaDefaults.apiKey) ?? ""
        if apiKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            zappaLogger.warning("Rewrite requested without configured bridge token")
            promptForZappaAPIKey()
            return
        }

        let bridgeURLString = defaults.string(forKey: ZappaDefaults.bridgeBaseURL) ?? "https://workstation.tailee9084.ts.net:19777"
        guard let bridgeURL = URL(string: bridgeURLString) else {
            zappaLogger.error("Rewrite requested with invalid bridge URL")
            showZappaMessage("Invalid Zappa bridge URL")
            return
        }

        let model = defaults.string(forKey: ZappaDefaults.model) ?? "gpt-5.3-codex-spark"
        let config = ZappaConfig(
            isEnabled: true,
            allowedHosts: [host],
            bridgeBaseURL: bridgeURL,
            apiKey: apiKey,
            model: model
        )
        let coordinator = ZappaRewriteCoordinator(configProvider: { config })
        zappaRewriteCoordinator = coordinator
        zappaLogger.info("Starting Zappa rewrite for host \(host, privacy: .public) using model \(model, privacy: .public)")
        coordinator.rewriteCurrentPage(from: webView, presenter: self)
    }

    private static var zappaRewriteButtonTag: Int {
        927_720
    }

    private var zappaRewriteCoordinator: ZappaRewriteCoordinator? {
        get {
            objc_getAssociatedObject(self, ZappaAssociationKeys.coordinator) as? ZappaRewriteCoordinator
        }
        set {
            objc_setAssociatedObject(self, ZappaAssociationKeys.coordinator, newValue, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
        }
    }

    private func promptForZappaAPIKey() {
        let alert = UIAlertController(
            title: "Zappa API Key",
            message: "Paste the local bridge bearer token.",
            preferredStyle: .alert
        )
        alert.addTextField { field in
            field.placeholder = "Bearer token"
            field.isSecureTextEntry = true
            field.autocorrectionType = .no
            field.autocapitalizationType = .none
        }
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        alert.addAction(UIAlertAction(title: "Save", style: .default) { [weak alert, weak self] _ in
            let value = alert?.textFields?.first?.text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            guard !value.isEmpty else {
                return
            }
            UserDefaults.standard.set(value, forKey: ZappaDefaults.apiKey)
            self?.zappaRewriteSelectedTab()
        })
        present(alert, animated: true)
    }

    private func showZappaMessage(_ message: String) {
        let alert = UIAlertController(title: "Zappa", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        present(alert, animated: true)
    }
}
