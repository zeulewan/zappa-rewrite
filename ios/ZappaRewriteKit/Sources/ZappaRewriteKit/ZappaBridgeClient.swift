import Foundation

public final class ZappaBridgeClient {
    private let session: URLSession
    private let jsonEncoder = JSONEncoder()
    private let jsonDecoder = JSONDecoder()

    public init(session: URLSession = .shared) {
        self.session = session
    }

    public func rewrite(
        _ request: ZappaRewriteRequest,
        config: ZappaConfig
    ) async throws -> ZappaRewriteResult {
        let responseText = try await performCompletionRequest(request, config: config, stream: false)
        let response = try jsonDecoder.decode(ChatCompletionResponse.self, from: Data(responseText.utf8))
        guard let content = response.choices.first?.message.content, !content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw ZappaBridgeError.emptyResponse
        }
        return try parseModelRewrite(content)
    }

    public func rewriteStream(
        _ request: ZappaRewriteRequest,
        config: ZappaConfig
    ) -> AsyncThrowingStream<String, Error> {
        AsyncThrowingStream { continuation in
            Task {
                do {
                    let urlRequest = try makeCompletionURLRequest(request, config: config, stream: true)
                    let (bytes, response) = try await session.bytes(for: urlRequest)
                    try validateHTTPResponse(response)
                    var eventBuffer = ""
                    for try await line in bytes.lines {
                        if line.isEmpty {
                            try emitSSEEvent(eventBuffer, continuation: continuation)
                            eventBuffer = ""
                        } else {
                            eventBuffer += line
                            eventBuffer += "\n"
                        }
                    }
                    if !eventBuffer.isEmpty {
                        try emitSSEEvent(eventBuffer, continuation: continuation)
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
        }
    }

    private func performCompletionRequest(
        _ request: ZappaRewriteRequest,
        config: ZappaConfig,
        stream: Bool
    ) async throws -> String {
        let urlRequest = try makeCompletionURLRequest(request, config: config, stream: stream)
        let (data, response) = try await session.data(for: urlRequest)
        try validateHTTPResponse(response)
        guard let text = String(data: data, encoding: .utf8) else {
            throw ZappaBridgeError.invalidUTF8
        }
        return text
    }

    private func makeCompletionURLRequest(
        _ request: ZappaRewriteRequest,
        config: ZappaConfig,
        stream: Bool
    ) throws -> URLRequest {
        let endpoint = config.bridgeBaseURL
            .appendingPathComponent("chat")
            .appendingPathComponent("completions")
        var urlRequest = URLRequest(url: endpoint)
        urlRequest.httpMethod = "POST"
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if !config.apiKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            urlRequest.setValue("Bearer \(config.apiKey)", forHTTPHeaderField: "Authorization")
        }
        let source = String(request.sourceHTML.prefix(config.maxInputCharacters))
        let userPayload = RewriteUserPayload(
            url: request.url.absoluteString,
            assetKind: "html",
            contentType: request.contentType,
            source: source
        )
        let userPayloadData = try jsonEncoder.encode(userPayload)
        let userPayloadText = String(data: userPayloadData, encoding: .utf8) ?? "{}"
        let payload = ChatCompletionRequest(
            model: config.model,
            temperature: 0,
            maxTokens: config.maxOutputTokens,
            stream: stream,
            messages: [
                ChatMessage(role: "system", content: ZappaSystemPrompt.current),
                ChatMessage(role: "user", content: userPayloadText)
            ]
        )
        urlRequest.httpBody = try jsonEncoder.encode(payload)
        return urlRequest
    }

    private func validateHTTPResponse(_ response: URLResponse) throws {
        guard let httpResponse = response as? HTTPURLResponse else {
            throw ZappaBridgeError.invalidHTTPResponse
        }
        guard (200..<300).contains(httpResponse.statusCode) else {
            throw ZappaBridgeError.httpStatus(httpResponse.statusCode)
        }
    }

    private func emitSSEEvent(
        _ event: String,
        continuation: AsyncThrowingStream<String, Error>.Continuation
    ) throws {
        let dataLines = event
            .split(separator: "\n", omittingEmptySubsequences: false)
            .compactMap { line -> String? in
                guard line.hasPrefix("data:") else {
                    return nil
                }
                return String(line.dropFirst(5)).trimmingCharacters(in: .whitespaces)
            }
        guard !dataLines.isEmpty else {
            return
        }
        let dataText = dataLines.joined(separator: "\n")
        if dataText == "[DONE]" {
            return
        }
        let chunk = try jsonDecoder.decode(ChatCompletionStreamChunk.self, from: Data(dataText.utf8))
        if let error = chunk.error {
            throw ZappaBridgeError.backend(error)
        }
        if let delta = chunk.choices.first?.delta.content, !delta.isEmpty {
            continuation.yield(delta)
        }
    }

    private func parseModelRewrite(_ text: String) throws -> ZappaRewriteResult {
        let trimmed = stripMarkdownFence(text.trimmingCharacters(in: .whitespacesAndNewlines))
        guard let data = trimmed.data(using: .utf8) else {
            throw ZappaBridgeError.invalidUTF8
        }
        if let envelope = try? jsonDecoder.decode(ModelRewriteEnvelope.self, from: data) {
            return ZappaRewriteResult(
                title: envelope.title ?? "",
                markdown: envelope.content,
                rawModelText: text
            )
        }
        return ZappaRewriteResult(markdown: trimmed, rawModelText: text)
    }

    private func stripMarkdownFence(_ text: String) -> String {
        guard text.hasPrefix("```") else {
            return text
        }
        var lines = text.components(separatedBy: .newlines)
        if lines.first?.hasPrefix("```") == true {
            lines.removeFirst()
        }
        if lines.last?.trimmingCharacters(in: .whitespacesAndNewlines) == "```" {
            lines.removeLast()
        }
        return lines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

public enum ZappaBridgeError: Error, Equatable, Sendable {
    case backend(String)
    case emptyResponse
    case httpStatus(Int)
    case invalidHTTPResponse
    case invalidUTF8
}
