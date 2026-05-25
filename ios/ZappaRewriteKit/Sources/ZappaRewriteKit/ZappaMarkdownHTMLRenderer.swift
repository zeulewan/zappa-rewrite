import Foundation

public enum ZappaMarkdownHTMLRenderer {
    public static func renderDocument(title: String, markdown: String, sourceURL: URL? = nil) -> String {
        let body = renderFragment(markdown)
        return """
        <!doctype html>
        <html>
        <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>\(escapeHTML(title.isEmpty ? "Zappa Rewrite" : title))</title>
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
            let trimmed = lines[index].trimmingCharacters(in: .whitespaces)
            if trimmed.isEmpty {
                index += 1
                continue
            }

            if let heading = parseHeading(trimmed) {
                html.append("<h\(heading.level)>\(renderInline(heading.text))</h\(heading.level)>")
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

            if trimmed.hasPrefix("- ") || trimmed.hasPrefix("* ") {
                var items: [String] = []
                while index < lines.count {
                    let row = lines[index].trimmingCharacters(in: .whitespaces)
                    guard row.hasPrefix("- ") || row.hasPrefix("* ") else {
                        break
                    }
                    items.append(String(row.dropFirst(2)))
                    index += 1
                }
                html.append("<ul>\(items.map { "<li>\(renderInline($0))</li>" }.joined())</ul>")
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
                if row.isEmpty || parseHeading(row) != nil || isTableStart(lines, index) || parseLoosePipeRow(row) != nil {
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
        var output = escapeHTML(text)
        output = replaceImages(in: output)
        output = replaceLinks(in: output)
        output = output.replacingOccurrences(of: #"\*\*([^*]+)\*\*"#, with: "<strong>$1</strong>", options: .regularExpression)
        output = output.replacingOccurrences(of: #"\*([^*]+)\*"#, with: "<em>$1</em>", options: .regularExpression)
        output = output.replacingOccurrences(of: #"`([^`]+)`"#, with: "<code>$1</code>", options: .regularExpression)
        return output
    }

    private static func replaceImages(in text: String) -> String {
        replaceRegex(
            pattern: #"!\[([^\]]*)\]\(([^)\s]+)\)"#,
            in: text
        ) { match in
            let alt = match[1]
            let src = match[2]
            return #"<img src="\#(src)" alt="\#(alt)" loading="eager">"#
        }
    }

    private static func replaceLinks(in text: String) -> String {
        replaceRegex(
            pattern: #"\[([^\]]+)\]\(([^)\s]+)\)"#,
            in: text
        ) { match in
            let label = match[1]
            let href = match[2]
            return #"<a href="\#(href)">\#(label)</a>"#
        }
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
