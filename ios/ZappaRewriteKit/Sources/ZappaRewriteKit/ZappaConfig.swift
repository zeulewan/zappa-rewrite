import Foundation

public struct ZappaConfig: Equatable, Sendable {
    public var isEnabled: Bool
    public var allowedHosts: Set<String>
    public var bridgeBaseURL: URL
    public var apiKey: String
    public var model: String
    public var maxInputCharacters: Int
    public var maxOutputTokens: Int

    public init(
        isEnabled: Bool = false,
        allowedHosts: Set<String> = [],
        bridgeBaseURL: URL = URL(string: "https://workstation.tailee9084.ts.net:19777")!,
        apiKey: String = "",
        model: String = "gpt-5.3-codex-spark",
        maxInputCharacters: Int = 2_000_000,
        maxOutputTokens: Int = 32_768
    ) {
        self.isEnabled = isEnabled
        self.allowedHosts = allowedHosts
        self.bridgeBaseURL = bridgeBaseURL
        self.apiKey = apiKey
        self.model = model
        self.maxInputCharacters = maxInputCharacters
        self.maxOutputTokens = maxOutputTokens
    }

    public func permits(url: URL) -> Bool {
        guard isEnabled, let host = url.host?.lowercased() else {
            return false
        }
        return allowedHosts.contains(host)
    }
}

