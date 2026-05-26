import Foundation
import OSLog
import UIKit
import WebKit

private let zappaRewriteLogger = Logger(subsystem: "ZappaRewrite", category: "Coordinator")

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
            zappaRewriteLogger.warning("Rewrite skipped because the current URL is not permitted")
            return
        }

        zappaRewriteLogger.info("Rewrite started for \(url.absoluteString, privacy: .public)")

        activeTask = Task { [client] in
            do {
                setPageStatus("Capturing page", in: webView)
                let html = try await captureHTML(from: webView)
                zappaRewriteLogger.info("Captured \(html.count, privacy: .public) HTML characters")
                try Task.checkCancellation()
                setPageStatus("Rewriting", in: webView)
                let request = ZappaRewriteRequest(url: url, sourceHTML: html)
                zappaRewriteLogger.info("Sending rewrite request with model \(config.model, privacy: .public)")
                let result = try await client.rewrite(request, config: config)
                zappaRewriteLogger.info("Received \(result.markdown.count, privacy: .public) Markdown characters")
                try Task.checkCancellation()
                setPageStatus("Rendering", in: webView)
                let document = ZappaMarkdownHTMLRenderer.renderDocument(
                    title: result.title,
                    markdown: result.markdown,
                    sourceURL: url
                )
                try? await removePageStatus(in: webView)
                try await replacePageContent(document, sourceURL: url, in: webView)
                try? await removePageStatus(in: webView)
                zappaRewriteLogger.info("Rewrite completed")
            } catch is CancellationError {
                setPageStatus("Canceled", in: webView, isError: true)
                zappaRewriteLogger.info("Rewrite canceled")
            } catch {
                setPageStatus("Rewrite failed: \(String(describing: error))", in: webView, isError: true)
                zappaRewriteLogger.error("Rewrite failed: \(String(describing: error), privacy: .public)")
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

    private func setPageStatus(_ text: String, in webView: WKWebView, isError: Bool = false) {
        Task {
            do {
                let textLiteral = try javaScriptLiteral(text)
                let background = isError ? "rgba(180, 32, 32, 0.94)" : "rgba(23, 23, 23, 0.92)"
                let script = """
                (() => {
                  const id = "__zappa_rewrite_status";
                  let badge = document.getElementById(id);
                  if (!badge) {
                    badge = document.createElement("div");
                    badge.id = id;
                    badge.style.position = "fixed";
                    badge.style.right = "16px";
                    badge.style.bottom = "92px";
                    badge.style.zIndex = "2147483647";
                    badge.style.maxWidth = "calc(100vw - 32px)";
                    badge.style.padding = "9px 12px";
                    badge.style.borderRadius = "999px";
                    badge.style.boxShadow = "0 10px 30px rgba(0,0,0,.22)";
                    badge.style.color = "white";
                    badge.style.font = "600 13px -apple-system,BlinkMacSystemFont,'Helvetica Neue',sans-serif";
                    badge.style.lineHeight = "1.25";
                    badge.style.pointerEvents = "none";
                    document.documentElement.appendChild(badge);
                  }
                  badge.style.background = "\(background)";
                  badge.textContent = \(textLiteral);
                })();
                """
                try await evaluateJavaScript(script, in: webView)
            } catch {
                zappaRewriteLogger.error("Failed to update page status: \(String(describing: error), privacy: .public)")
            }
        }
    }

    private func replacePageContent(_ html: String, sourceURL: URL, in webView: WKWebView) async throws {
        let htmlLiteral = try javaScriptLiteral(html)
        let urlLiteral = try javaScriptLiteral(sourceURL.absoluteString)
        let script = """
        (() => {
          const html = \(htmlLiteral);
          const sourceURL = \(urlLiteral);
          const nextDocument = new DOMParser().parseFromString(html, "text/html");
          const allowedTags = new Set([
            "a", "abbr", "article", "b", "blockquote", "br", "button", "caption", "cite", "code",
            "col", "colgroup", "dd", "del", "details", "dfn", "div", "dl", "dt", "em", "fieldset",
            "figcaption", "figure", "form", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img",
            "input", "ins", "kbd", "label", "legend", "li", "main", "mark", "ol", "option", "p",
            "pre", "q", "samp", "section", "select", "small", "span", "strong", "sub", "summary",
            "sup", "table", "tbody", "td", "textarea", "tfoot", "th", "thead", "time", "tr", "u",
            "ul", "var"
          ]);
          const allowedAttrs = new Set([
            "action", "alt", "checked", "cite", "colspan", "datetime", "decoding", "disabled",
            "for", "height", "href", "id", "loading", "method", "name", "placeholder", "rel",
            "required", "rowspan", "scope", "selected", "src", "title", "type", "value", "width"
          ]);
          const removeTags = new Set([
            "script", "style", "template", "iframe", "object", "embed", "svg", "canvas", "video",
            "audio", "source", "track"
          ]);
          const urlAttrs = new Set(["href", "src", "cite", "action"]);
          const unwrap = (node) => {
            const parent = node.parentNode;
            if (!parent) return;
            while (node.firstChild) parent.insertBefore(node.firstChild, node);
            node.remove();
          };
          const isSafeURL = (value) => {
            const trimmed = String(value || "").trim();
            return Boolean(trimmed) && !/^(?:javascript|data|vbscript):/i.test(trimmed);
          };
          const resolveURL = (value) => {
            const trimmed = String(value || "").trim();
            if (!trimmed || trimmed.startsWith("#") || /^(?:mailto|tel):/i.test(trimmed)) return trimmed;
            try {
              return new URL(trimmed, sourceURL).toString();
            } catch (error) {
              return trimmed;
            }
          };
          const sanitizeBody = (body) => {
            for (const node of Array.from(body.querySelectorAll("*"))) {
              const tagName = node.tagName.toLowerCase();
              if (!allowedTags.has(tagName)) {
                if (removeTags.has(tagName)) {
                  node.remove();
                } else {
                  unwrap(node);
                }
                continue;
              }
              for (const attribute of Array.from(node.attributes)) {
                const name = attribute.name.toLowerCase();
                const value = attribute.value;
                if (
                  name.startsWith("on") ||
                  name === "style" ||
                  name === "srcset" ||
                  name === "sizes" ||
                  name === "integrity" ||
                  name === "nonce" ||
                  name.startsWith("data-") ||
                  name.startsWith("aria-") ||
                  !allowedAttrs.has(name)
                ) {
                  node.removeAttribute(attribute.name);
                  continue;
                }
                if (urlAttrs.has(name)) {
                  if (!isSafeURL(value)) {
                    node.removeAttribute(attribute.name);
                    continue;
                  }
                  const resolved = resolveURL(value);
                  if (resolved) node.setAttribute(name, resolved);
                }
                if ((name === "width" || name === "height") && !/^[0-9]{1,5}$/.test(value.trim())) {
                  node.removeAttribute(attribute.name);
                }
              }
              if (tagName === "img") {
                if (!node.getAttribute("src")) {
                  node.remove();
                } else {
                  if (!node.getAttribute("loading")) node.setAttribute("loading", "eager");
                  if (!node.getAttribute("decoding")) node.setAttribute("decoding", "async");
                }
              }
              if (tagName === "a" && !node.getAttribute("href")) {
                unwrap(node);
              }
            }
          };
          if (nextDocument.body) sanitizeBody(nextDocument.body);
          const nextRoot = document.importNode(nextDocument.documentElement, true);
          document.replaceChild(nextRoot, document.documentElement);
          try {
            history.replaceState(history.state, document.title, sourceURL);
          } catch (error) {}
          window.scrollTo(0, 0);
        })();
        """
        try await evaluateJavaScript(script, in: webView)
    }

    private func removePageStatus(in webView: WKWebView) async throws {
        let script = """
        (() => {
          document.getElementById("__zappa_rewrite_status")?.remove();
        })();
        """
        try await evaluateJavaScript(script, in: webView)
    }

    private func evaluateJavaScript(_ script: String, in webView: WKWebView) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            webView.evaluateJavaScript(script) { _result, error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume()
                }
            }
        }
    }

    private func javaScriptLiteral(_ string: String) throws -> String {
        let data = try JSONSerialization.data(withJSONObject: [string], options: [])
        guard let arrayLiteral = String(data: data, encoding: .utf8) else {
            throw ZappaBridgeError.invalidUTF8
        }
        return String(arrayLiteral.dropFirst().dropLast())
    }
}
