import Foundation

public struct ZappaRewriteRequest: Equatable, Sendable {
    public var url: URL
    public var contentType: String
    public var sourceHTML: String

    public init(url: URL, contentType: String = "text/html; charset=utf-8", sourceHTML: String) {
        self.url = url
        self.contentType = contentType
        self.sourceHTML = sourceHTML
    }
}

public struct ZappaRewriteResult: Equatable, Sendable {
    public var title: String
    public var markdown: String
    public var rawModelText: String

    public init(title: String = "", markdown: String, rawModelText: String = "") {
        self.title = title
        self.markdown = markdown
        self.rawModelText = rawModelText
    }
}

struct ChatCompletionRequest: Encodable {
    var model: String
    var temperature: Int
    var maxTokens: Int
    var stream: Bool
    var messages: [ChatMessage]

    enum CodingKeys: String, CodingKey {
        case model
        case temperature
        case maxTokens = "max_tokens"
        case stream
        case messages
    }
}

struct ChatMessage: Codable, Equatable {
    var role: String
    var content: String
}

struct RewriteUserPayload: Encodable {
    var url: String
    var assetKind: String
    var contentType: String
    var source: String

    enum CodingKeys: String, CodingKey {
        case url
        case assetKind = "asset_kind"
        case contentType = "content_type"
        case source
    }
}

struct ChatCompletionResponse: Decodable {
    var choices: [Choice]

    struct Choice: Decodable {
        var message: ChatMessage
    }
}

struct ChatCompletionStreamChunk: Decodable {
    var choices: [Choice]
    var error: String?

    struct Choice: Decodable {
        var delta: Delta
        var finishReason: String?

        enum CodingKeys: String, CodingKey {
            case delta
            case finishReason = "finish_reason"
        }
    }

    struct Delta: Decodable {
        var content: String?
    }
}

struct ModelRewriteEnvelope: Decodable {
    var format: String?
    var title: String?
    var content: String
}

