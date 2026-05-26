import Common
import ObjectiveC
import OSLog
import UIKit
import WebKit

private let zappaLogger = Logger(subsystem: "ZappaRewrite", category: "FirefoxOverlay")

private enum ZappaAssociationKeys {
    nonisolated(unsafe) static let coordinator: UnsafeRawPointer = UnsafeRawPointer(bitPattern: 0x7A_61_70_70_61)!
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
        guard view.viewWithTag(Self.zappaRewriteButtonTag) == nil else {
            return
        }

        let button = UIButton(type: .system)
        button.tag = Self.zappaRewriteButtonTag
        button.setTitle("Z", for: .normal)
        button.titleLabel?.font = .boldSystemFont(ofSize: 17)
        button.backgroundColor = UIColor.systemBackground.withAlphaComponent(0.92)
        button.tintColor = .label
        button.layer.cornerRadius = 22
        button.layer.borderWidth = 1
        button.layer.borderColor = UIColor.separator.cgColor
        button.layer.shadowColor = UIColor.black.cgColor
        button.layer.shadowOpacity = 0.15
        button.layer.shadowRadius = 8
        button.layer.shadowOffset = CGSize(width: 0, height: 2)
        button.layer.zPosition = 10_000
        button.accessibilityLabel = "Rewrite with Zappa"
        button.accessibilityIdentifier = "zappa.rewrite.button"
        button.addTarget(self, action: #selector(zappaRewriteSelectedTab), for: .touchUpInside)
        button.translatesAutoresizingMaskIntoConstraints = false

        view.addSubview(button)
        NSLayoutConstraint.activate([
            button.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -18),
            button.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -86),
            button.widthAnchor.constraint(equalToConstant: 44),
            button.heightAnchor.constraint(equalToConstant: 44)
        ])
        raiseZappaRewriteButton()
        DispatchQueue.main.async { [weak self] in
            self?.raiseZappaRewriteButton()
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self] in
            self?.raiseZappaRewriteButton()
        }
        zappaLogger.info("Installed Zappa rewrite button")
    }

    func raiseZappaRewriteButton() {
        guard let button = view.viewWithTag(Self.zappaRewriteButtonTag) else {
            return
        }
        view.bringSubviewToFront(button)
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
