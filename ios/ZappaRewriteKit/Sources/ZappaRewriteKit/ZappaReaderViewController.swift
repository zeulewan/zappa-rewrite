import UIKit
import WebKit

@MainActor
public final class ZappaReaderViewController: UIViewController {
    private let sourceURL: URL
    private let webView = WKWebView(frame: .zero)
    private let statusLabel = UILabel()

    public init(sourceURL: URL) {
        self.sourceURL = sourceURL
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .pageSheet
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    public override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        configureChrome()
        configureWebView()
        setStatus("Starting")
    }

    public func setStatus(_ text: String) {
        statusLabel.text = text
    }

    public func loadHTML(_ html: String, baseURL: URL?) {
        webView.loadHTMLString(html, baseURL: baseURL)
    }

    public func showError(_ error: Error) {
        setStatus("Error")
        let message = String(describing: error)
        let html = ZappaMarkdownHTMLRenderer.renderDocument(
            title: "Zappa Error",
            markdown: "# Rewrite failed\n\n`\(message)`",
            sourceURL: sourceURL
        )
        webView.loadHTMLString(html, baseURL: sourceURL)
    }

    private func configureChrome() {
        let closeButton = UIButton(type: .system)
        closeButton.setTitle("Done", for: .normal)
        closeButton.addTarget(self, action: #selector(close), for: .touchUpInside)

        statusLabel.font = .preferredFont(forTextStyle: .footnote)
        statusLabel.textColor = .secondaryLabel
        statusLabel.textAlignment = .center
        statusLabel.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)

        let toolbar = UIStackView(arrangedSubviews: [statusLabel, closeButton])
        toolbar.axis = .horizontal
        toolbar.alignment = .center
        toolbar.spacing = 12
        toolbar.layoutMargins = UIEdgeInsets(top: 8, left: 16, bottom: 8, right: 16)
        toolbar.isLayoutMarginsRelativeArrangement = true
        toolbar.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(toolbar)

        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)

        NSLayoutConstraint.activate([
            toolbar.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            toolbar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            toolbar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.topAnchor.constraint(equalTo: toolbar.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
    }

    private func configureWebView() {
        webView.isOpaque = false
        webView.backgroundColor = .clear
    }

    @objc
    private func close() {
        dismiss(animated: true)
    }
}

