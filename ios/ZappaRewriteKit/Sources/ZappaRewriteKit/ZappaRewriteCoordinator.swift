import Foundation
import UIKit
import WebKit

@MainActor
public final class ZappaRewriteCoordinator {
    private let client: ZappaBridgeClient
    private let configProvider: () -> ZappaConfig
    private var activeTask: Task<Void, Never>?

    public init(
        client: ZappaBridgeClient = ZappaBridgeClient(),
        configProvider: @escaping () -> ZappaConfig
    ) {
        self.client = client
        self.configProvider = configProvider
    }

    public func cancel() {
        activeTask?.cancel()
        activeTask = nil
    }

    public func rewriteCurrentPage(from webView: WKWebView, presenter: UIViewController) {
        cancel()
        let config = configProvider()
        guard let url = webView.url, config.permits(url: url) else {
            return
        }

        let reader = ZappaReaderViewController(sourceURL: url)
        presenter.present(reader, animated: true)

        activeTask = Task { [client] in
            do {
                reader.setStatus("Capturing page")
                let html = try await captureHTML(from: webView)
                try Task.checkCancellation()
                reader.setStatus("Rewriting")
                let request = ZappaRewriteRequest(url: url, sourceHTML: html)
                let result = try await client.rewrite(request, config: config)
                try Task.checkCancellation()
                reader.setStatus("Rendering")
                let document = ZappaMarkdownHTMLRenderer.renderDocument(
                    title: result.title,
                    markdown: result.markdown,
                    sourceURL: url
                )
                reader.loadHTML(document, baseURL: url)
                reader.setStatus("Done")
            } catch is CancellationError {
                reader.setStatus("Canceled")
            } catch {
                reader.showError(error)
            }
        }
    }

    private func captureHTML(from webView: WKWebView) async throws -> String {
        try await withCheckedThrowingContinuation { continuation in
            webView.evaluateJavaScript(ZappaPageCapture.javaScript) { result, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }
                guard let html = result as? String, !html.isEmpty else {
                    continuation.resume(throwing: ZappaBridgeError.emptyResponse)
                    return
                }
                continuation.resume(returning: html)
            }
        }
    }
}

