import Foundation

public enum ZappaMarkdownHTMLRenderer {
    public static func renderDocument(title: String, markdown: String, sourceURL: URL? = nil) -> String {
        let body = renderFragment(markdown)
        let base = sourceURL.map { #"<base href="\#(escapeHTML($0.absoluteString))">"# } ?? ""
        return """
        <!doctype html>
        <html>
        <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <meta http-equiv="Content-Security-Policy" content="default-src 'self' http: https: data: blob:; script-src 'none'; object-src 'none'; frame-src 'none'; style-src 'unsafe-inline'; img-src http: https: data: blob:;">
        <title>\(escapeHTML(title.isEmpty ? "Zappa Rewrite" : title))</title>
        \(base)
        <style>
        body{margin:0;background:#fbfbf8;color:#171717;font:17px/1.6 -apple-system,BlinkMacSystemFont,"Helvetica Neue",sans-serif}
        main{width:min(100% - 32px,760px);margin:0 auto;padding:28px 0 56px}
        h1,h2,h3{line-height:1.18;margin:1.5em 0 .5em}
        h1{font-size:2rem} h2{font-size:1.45rem} h3{font-size:1.15rem}
        a{color:#0645ad;text-decoration-thickness:.08em;text-underline-offset:.16em}
        img{max-width:100%;height:auto;border-radius:6px}
        figure{margin:1.25rem 0} figcaption{font-size:.92rem;color:#555}
        table{width:100%;border-collapse:collapse;margin:1rem 0;font-size:.95rem}
        th,td{border:1px solid #d8d8d2;padding:.45rem .55rem;text-align:left;vertical-align:top}
        blockquote{border-left:3px solid #c9c9c2;margin:1rem 0;padding-left:1rem;color:#444}
        code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
        pre{overflow:auto;background:#f0f0eb;padding:1rem;border-radius:6px}
        </style>
        </head>
        <body><main>\(body)</main></body>
        </html>
        """
    }

    public static func renderFragment(_ markdown: String) -> String {
        let lines = markdown.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n")
        var html: [String] = []
        var index = 0

        while index < lines.count {
            let line = lines[index]
            let trimmed = lines[index].trimmingCharacters(in: .whitespaces)
            if trimmed.isEmpty {
                index += 1
                continue
            }

            if let fence = parseCodeFence(trimmed) {
                var codeLines: [String] = []
                index += 1
                while index < lines.count, !isClosingCodeFence(lines[index].trimmingCharacters(in: .whitespaces)) {
                    codeLines.append(lines[index])
                    index += 1
                }
                if index < lines.count {
                    index += 1
                }
                let codeText = codeLines.joined(separator: "\n")
                let trimmedCode = codeText.trimmingCharacters(in: .whitespacesAndNewlines)
                if (fence == "html" || fence == "htm"), rawHTMLBlockTag(trimmedCode) != nil {
                    html.append(normalizeRawHTMLBlock(trimmedCode))
                } else {
                    html.append("<pre><code>\(escapeHTML(codeText))</code></pre>")
                }
                continue
            }

            if let tag = rawHTMLBlockTag(trimmed) {
                let block = collectRawHTMLBlock(lines, startingAt: index, tag: tag)
                html.append(normalizeRawHTMLBlock(block.html))
                index = block.nextIndex
                continue
            }

            if let heading = parseHeading(trimmed) {
                html.append("<h\(heading.level)>\(renderInline(heading.text))</h\(heading.level)>")
                index += 1
                continue
            }

            if isHorizontalRule(trimmed) {
                html.append("<hr>")
                index += 1
                continue
            }

            if isTableStart(lines, index) {
                var tableLines: [String] = []
                while index < lines.count, splitTableRow(lines[index]) != nil {
                    tableLines.append(lines[index])
                    index += 1
                }
                html.append(renderTable(tableLines))
                continue
            }

            if let looseRow = parseLoosePipeRow(trimmed) {
                html.append(renderLoosePipeRow(looseRow))
                index += 1
                continue
            }

            if isUnorderedListItem(line) {
                var items: [String] = []
                while index < lines.count {
                    guard isUnorderedListItem(lines[index]) else {
                        break
                    }
                    items.append(lines[index].replacingOccurrences(of: #"^\s*[-*+]\s+"#, with: "", options: .regularExpression))
                    index += 1
                }
                html.append("<ul>\(items.map { "<li>\(renderInline($0))</li>" }.joined())</ul>")
                continue
            }

            if isOrderedListItem(line) {
                var items: [String] = []
                while index < lines.count {
                    guard isOrderedListItem(lines[index]) else {
                        break
                    }
                    items.append(lines[index].replacingOccurrences(of: #"^\s*\d+[.)]\s+"#, with: "", options: .regularExpression))
                    index += 1
                }
                html.append("<ol>\(items.map { "<li>\(renderInline($0))</li>" }.joined())</ol>")
                continue
            }

            if trimmed.hasPrefix(">") {
                var items: [String] = []
                while index < lines.count {
                    let row = lines[index].trimmingCharacters(in: .whitespaces)
                    guard row.hasPrefix(">") else {
                        break
                    }
                    items.append(String(row.dropFirst()).trimmingCharacters(in: .whitespaces))
                    index += 1
                }
                html.append("<blockquote><p>\(renderInline(items.joined(separator: " ")))</p></blockquote>")
                continue
            }

            var paragraph = [trimmed]
            index += 1
            while index < lines.count {
                let row = lines[index].trimmingCharacters(in: .whitespaces)
                if row.isEmpty || isBlockStart(lines, index) {
                    break
                }
                paragraph.append(row)
                index += 1
            }
            html.append("<p>\(renderInline(paragraph.joined(separator: " ")))</p>")
        }

        return html.joined(separator: "\n")
    }

    private static func parseHeading(_ line: String) -> (level: Int, text: String)? {
        let markerCount = line.prefix { $0 == "#" }.count
        guard (1...6).contains(markerCount), line.dropFirst(markerCount).first == " " else {
            return nil
        }
        return (markerCount, String(line.dropFirst(markerCount + 1)))
    }

    private static func parseCodeFence(_ line: String) -> String? {
        guard let match = firstMatch(pattern: #"^```([a-z0-9_-]+)?\s*$"#, in: line, options: [.caseInsensitive]) else {
            return nil
        }
        return match.count > 1 ? match[1].lowercased() : ""
    }

    private static func isClosingCodeFence(_ line: String) -> Bool {
        firstMatch(pattern: #"^```\s*$"#, in: line) != nil
    }

    private static func isBlockStart(_ lines: [String], _ index: Int) -> Bool {
        let line = lines[index]
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        return parseCodeFence(trimmed) != nil ||
            rawHTMLBlockTag(trimmed) != nil ||
            parseHeading(trimmed) != nil ||
            isHorizontalRule(trimmed) ||
            isTableStart(lines, index) ||
            parseLoosePipeRow(trimmed) != nil ||
            trimmed.hasPrefix(">") ||
            isUnorderedListItem(line) ||
            isOrderedListItem(line)
    }

    private static func isHorizontalRule(_ line: String) -> Bool {
        firstMatch(pattern: #"^(?:-{3,}|\*{3,}|_{3,})$"#, in: line) != nil
    }

    private static func isUnorderedListItem(_ line: String) -> Bool {
        firstMatch(pattern: #"^\s*[-*+]\s+"#, in: line) != nil
    }

    private static func isOrderedListItem(_ line: String) -> Bool {
        firstMatch(pattern: #"^\s*\d+[.)]\s+"#, in: line) != nil
    }

    private static func isTableStart(_ lines: [String], _ index: Int) -> Bool {
        guard index + 1 < lines.count,
              let headers = splitTableRow(lines[index]),
              let separators = splitTableRow(lines[index + 1]),
              headers.count >= 2,
              separators.count >= 2 else {
            return false
        }
        return separators.allSatisfy(isSeparatorCell)
    }

    private static func renderTable(_ lines: [String]) -> String {
        let rows = lines.compactMap(splitTableRow).filter { $0.count >= 2 }
        guard rows.count >= 2 else {
            return ""
        }
        let headers = rows[0]
        let bodyRows = rows.dropFirst(2).filter { !$0.allSatisfy(isSeparatorCell) }
        let headerHTML = headers.map { "<th>\(renderInline($0))</th>" }.joined()
        let bodyHTML = bodyRows.map { row in
            "<tr>\(row.map { "<td>\(renderInline($0))</td>" }.joined())</tr>"
        }.joined()
        return "<table><thead><tr>\(headerHTML)</tr></thead><tbody>\(bodyHTML)</tbody></table>"
    }

    private static func splitTableRow(_ line: String) -> [String]? {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        guard trimmed.contains("|") else {
            return nil
        }
        var row = trimmed
        if row.hasPrefix("|") {
            row.removeFirst()
        }
        if row.hasSuffix("|") {
            row.removeLast()
        }
        return row.split(separator: "|", omittingEmptySubsequences: false)
            .map { $0.trimmingCharacters(in: .whitespaces) }
    }

    private static func parseLoosePipeRow(_ line: String) -> [String]? {
        guard line.hasPrefix("|") || line.hasSuffix("|"),
              let row = splitTableRow(line),
              row.count >= 2,
              !row.allSatisfy(isSeparatorCell) else {
            return nil
        }
        let cells = row.filter { !$0.isEmpty }
        return cells.count >= 2 ? cells : nil
    }

    private static func renderLoosePipeRow(_ row: [String]) -> String {
        let cells = row.map { "<td>\(renderInline($0))</td>" }.joined()
        return "<table><tbody><tr>\(cells)</tr></tbody></table>"
    }

    private static func isSeparatorCell(_ cell: String) -> Bool {
        let trimmed = cell.trimmingCharacters(in: CharacterSet(charactersIn: ":- "))
        return trimmed.isEmpty && cell.contains("---")
    }

    private static func renderInline(_ text: String) -> String {
        var tokens: [String] = []
        var output = protectRawHTMLFragments(in: text, tokens: &tokens)
        output = escapeHTML(output)
        output = replaceCode(in: output, tokens: &tokens)
        output = replaceImages(in: output, tokens: &tokens)
        output = replaceLinks(in: output, tokens: &tokens)
        output = output.replacingOccurrences(of: #"\*\*([^*]+)\*\*"#, with: "<strong>$1</strong>", options: .regularExpression)
        output = output.replacingOccurrences(of: #"__([^_]+)__"#, with: "<strong>$1</strong>", options: .regularExpression)
        output = output.replacingOccurrences(of: #"\*([^*]+)\*"#, with: "<em>$1</em>", options: .regularExpression)
        output = output.replacingOccurrences(of: #"_([^_]+)_"#, with: "<em>$1</em>", options: .regularExpression)
        return restoreTokens(in: output, tokens: tokens)
    }

    private static func protectRawHTMLFragments(in text: String, tokens: inout [String]) -> String {
        let blockTags = "address|article|aside|details|div|figure|form|main|nav|picture|section|summary|table"
        var output = text
        let patterns = [
            #"(?is)<(\#(blockTags))\b[\s\S]*?</\1>"#,
            #"(?is)&lt;(\#(blockTags))\b[\s\S]*?&lt;/\1&gt;"#,
            #"(?is)<img\b[^>]*\/?>"#,
            #"(?is)&lt;img\b[\s\S]*?\/?&gt;"#
        ]
        for pattern in patterns {
            output = replaceRegex(pattern: pattern, in: output) { match in
                stashToken(normalizeRawHTMLBlock(match[0]), tokens: &tokens)
            }
        }
        return output
    }

    private static func replaceCode(in text: String, tokens: inout [String]) -> String {
        replaceRegex(pattern: #"`([^`]+)`"#, in: text) { match in
            stashToken("<code>\(match[1])</code>", tokens: &tokens)
        }
    }

    private static func replaceImages(in text: String, tokens: inout [String]) -> String {
        replaceRegex(
            pattern: #"!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)"#,
            in: text
        ) { match in
            let alt = match[1]
            let src = match[2]
            guard isSafeURL(unescapeHTMLEntities(src)) else {
                return ""
            }
            let title = match.count > 3 && !match[3].isEmpty ? #" title="\#(match[3])""# : ""
            return stashToken(#"<img src="\#(src)" alt="\#(alt)"\#(title) loading="eager" decoding="async">"#, tokens: &tokens)
        }
    }

    private static func replaceLinks(in text: String, tokens: inout [String]) -> String {
        replaceRegex(
            pattern: #"\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)"#,
            in: text
        ) { match in
            let label = match[1]
            let href = match[2]
            guard isSafeURL(unescapeHTMLEntities(href)) else {
                return label
            }
            let title = match.count > 3 && !match[3].isEmpty ? #" title="\#(match[3])""# : ""
            return stashToken(#"<a href="\#(href)"\#(title)>\#(label)</a>"#, tokens: &tokens)
        }
    }

    private static func stashToken(_ html: String, tokens: inout [String]) -> String {
        let token = "\u{0}\(tokens.count)\u{0}"
        tokens.append(html)
        return token
    }

    private static func restoreTokens(in text: String, tokens: [String]) -> String {
        var output = text
        for (index, html) in tokens.enumerated() {
            output = output.replacingOccurrences(of: "\u{0}\(index)\u{0}", with: html)
        }
        return output
    }

    private static let rawHTMLBlockTags: Set<String> = [
        "address",
        "article",
        "aside",
        "details",
        "div",
        "figcaption",
        "figure",
        "form",
        "img",
        "main",
        "nav",
        "picture",
        "section",
        "summary",
        "table"
    ]

    private static let rawHTMLVoidTags: Set<String> = [
        "area",
        "br",
        "col",
        "hr",
        "img",
        "input",
        "wbr"
    ]

    private static func rawHTMLBlockTag(_ line: String) -> String? {
        let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
        if let match = firstMatch(pattern: #"^</?([a-z][a-z0-9-]*)\b"#, in: trimmed, options: [.caseInsensitive]) {
            let tag = match[1].lowercased()
            return rawHTMLBlockTags.contains(tag) ? tag : nil
        }
        if let match = firstMatch(pattern: #"^&lt;/?([a-z][a-z0-9-]*)(?:\s|&gt;|/?&gt;)"#, in: trimmed, options: [.caseInsensitive]) {
            let tag = match[1].lowercased()
            return rawHTMLBlockTags.contains(tag) ? tag : nil
        }
        return nil
    }

    private static func collectRawHTMLBlock(_ lines: [String], startingAt index: Int, tag: String) -> (html: String, nextIndex: Int) {
        var rawLines: [String] = []
        var current = index
        while current < lines.count {
            rawLines.append(lines[current])
            let line = lines[current]
            current += 1
            if rawHTMLVoidTags.contains(tag) || containsClosingTag(line, tag: tag) {
                break
            }
            if current >= lines.count || lines[current].trimmingCharacters(in: .whitespaces).isEmpty {
                break
            }
        }
        return (rawLines.joined(separator: "\n"), current)
    }

    private static func containsClosingTag(_ line: String, tag: String) -> Bool {
        let escapedPattern = #"&lt;/\#(NSRegularExpression.escapedPattern(for: tag))(?:\s|&gt;)"#
        let literalPattern = #"</\#(NSRegularExpression.escapedPattern(for: tag))(?:\s|>)"#
        return firstMatch(pattern: literalPattern, in: line, options: [.caseInsensitive]) != nil ||
            firstMatch(pattern: escapedPattern, in: line, options: [.caseInsensitive]) != nil
    }

    private static func normalizeRawHTMLBlock(_ rawHTML: String) -> String {
        let trimmed = rawHTML.trimmingCharacters(in: .whitespacesAndNewlines)
        let html = trimmed.hasPrefix("&lt;") ? unescapeHTMLEntities(trimmed) : trimmed
        return sanitizeRawHTMLFragment(html)
    }

    private static func sanitizeRawHTMLFragment(_ html: String) -> String {
        var output = html
        for tag in ["script", "style", "template", "iframe", "object", "embed", "svg", "canvas", "video", "audio", "source", "track"] {
            let escapedTag = NSRegularExpression.escapedPattern(for: tag)
            output = replaceRegex(pattern: #"(?is)<\s*\#(escapedTag)\b[\s\S]*?<\s*/\s*\#(escapedTag)\s*>"#, in: output) { _ in "" }
            output = replaceRegex(pattern: #"(?is)<\s*\#(escapedTag)\b[^>]*\/?\s*>"#, in: output) { _ in "" }
        }
        output = replaceRegex(
            pattern: #"(?i)\s+(?:on[a-z0-9_-]+|style|srcset|sizes|integrity|nonce|data-[a-z0-9_-]+|aria-[a-z0-9_-]+)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)"#,
            in: output
        ) { _ in "" }
        output = replaceRegex(
            pattern: #"(?i)\s+(href|src|cite|action)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)"#,
            in: output
        ) { match in
            let rawValue = stripAttributeQuotes(match[2])
            return isSafeURL(unescapeHTMLEntities(rawValue)) ? match[0] : ""
        }
        output = replaceRegex(
            pattern: #"(?i)\s+(width|height)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)"#,
            in: output
        ) { match in
            let rawValue = stripAttributeQuotes(match[2])
            return isSafeDimensionValue(rawValue) ? match[0] : ""
        }
        return output
    }

    private static func stripAttributeQuotes(_ value: String) -> String {
        guard value.count >= 2 else {
            return value
        }
        if (value.hasPrefix("\"") && value.hasSuffix("\"")) || (value.hasPrefix("'") && value.hasSuffix("'")) {
            return String(value.dropFirst().dropLast())
        }
        return value
    }

    private static func isSafeURL(_ value: String) -> Bool {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return !trimmed.isEmpty && firstMatch(pattern: #"^(?:javascript|data|vbscript):"#, in: trimmed, options: [.caseInsensitive]) == nil
    }

    private static func isSafeDimensionValue(_ value: String) -> Bool {
        firstMatch(pattern: #"^[0-9]{1,5}$"#, in: value.trimmingCharacters(in: .whitespacesAndNewlines)) != nil
    }

    private static func unescapeHTMLEntities(_ text: String) -> String {
        text
            .replacingOccurrences(of: "&amp;", with: "&")
            .replacingOccurrences(of: "&lt;", with: "<")
            .replacingOccurrences(of: "&gt;", with: ">")
            .replacingOccurrences(of: "&quot;", with: "\"")
            .replacingOccurrences(of: "&#39;", with: "'")
    }

    private static func firstMatch(pattern: String, in text: String, options: NSRegularExpression.Options = []) -> [String]? {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: options) else {
            return nil
        }
        let nsText = text as NSString
        guard let match = regex.firstMatch(in: text, range: NSRange(location: 0, length: nsText.length)) else {
            return nil
        }
        var groups: [String] = []
        for index in 0..<match.numberOfRanges {
            let range = match.range(at: index)
            groups.append(range.location == NSNotFound ? "" : nsText.substring(with: range))
        }
        return groups
    }

    private static func replaceRegex(
        pattern: String,
        in text: String,
        replacement: ([String]) -> String
    ) -> String {
        guard let regex = try? NSRegularExpression(pattern: pattern) else {
            return text
        }
        let nsText = text as NSString
        let matches = regex.matches(in: text, range: NSRange(location: 0, length: nsText.length)).reversed()
        var output = text
        for match in matches {
            var groups: [String] = []
            for index in 0..<match.numberOfRanges {
                let range = match.range(at: index)
                groups.append(range.location == NSNotFound ? "" : nsText.substring(with: range))
            }
            if let range = Range(match.range, in: output) {
                output.replaceSubrange(range, with: replacement(groups))
            }
        }
        return output
    }

    private static func escapeHTML(_ text: String) -> String {
        text
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
    }
}
