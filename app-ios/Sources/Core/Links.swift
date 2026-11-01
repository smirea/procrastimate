import Foundation

/// The link rules of `shared/links.ts`. Offsets count UTF-16 code units, as on the web.
public enum Links {
    public typealias Segment = API.TextSegment

    /// A Markdown `[label](url)`, as Todoist exports links, or a bare `http(s)://` or `www.` address. Only web URLs
    /// count, and bare domains such as `example.com` do not, since `file.txt` or `v1.2` would read as one.
    static let link = JSRegex(
        #"\[([^\[\]\n]+)\]\((https?:\/\/(?:[^\s()]|\([^\s()]*\))+)\)|(?<![\w.@/])(?:https?:\/\/|www\.)[^\s<>"]+"#,
        ignoreCase: true
    )

    private static let trailing = Set(".,;:!?'\"*_".utf16)

    private static func count(_ units: ArraySlice<UInt16>, _ char: Character) -> Int {
        let unit = char.utf16.first!
        return units.reduce(0) { $1 == unit ? $0 + 1 : $0 }
    }

    /// Sentence punctuation after a bare URL ends it, and so does a closing bracket it never opened, as in
    /// `(see https://a.com)`.
    static func trimBare(_ url: [UInt16]) -> Int {
        var end = url.count
        while end > 0 {
            let last = url[end - 1]
            let body = url[..<end]
            if trailing.contains(last) {
                end -= 1
            } else if last == 0x29, count(body, "(") < count(body, ")") {
                end -= 1
            } else if last == 0x5D, count(body, "[") < count(body, "]") {
                end -= 1
            } else {
                break
            }
        }
        return end
    }

    private static func isBareScheme(_ url: String) -> Bool {
        ["http://", "https://", "www."].contains(url.lowercased())
    }

    /// Splits text into plain runs and links, for display. Highlight `ranges` over the source text become each
    /// segment's `marks`, and a Markdown link's marks fall on its label.
    public static func linkify(_ text: String, _ ranges: [Range<Int>] = []) -> [Segment] {
        let units = Array(text.utf16)
        var segments: [Segment] = []
        func push(_ display: String, _ href: String?, _ start: Int, _ end: Int, _ at: Int) {
            let length = display.utf16.count
            guard length > 0 else { return }
            let marks = ranges.compactMap { range -> Range<Int>? in
                let from = max(range.lowerBound - at, 0)
                let to = min(range.upperBound - at, length)
                return from < to ? from..<to : nil
            }
            segments.append(Segment(text: display, href: href, start: start, end: end, marks: marks))
        }
        func slice(_ from: Int, _ to: Int) -> String { UTF16Text.string(units[from..<to]) }

        var cursor = 0
        for found in link.matches(in: text) {
            let start = found.start
            let end: Int
            if let label = found[1], let target = found[2] {
                end = found.end
                push(slice(cursor, start), nil, cursor, start, cursor)
                push(label, target, start, end, start + 1)
            } else {
                end = start + trimBare(Array(units[start..<found.end]))
                let url = slice(start, end)
                if isBareScheme(url) { continue }
                push(slice(cursor, start), nil, cursor, start, cursor)
                push(url, url.lowercased().hasPrefix("www.") ? "https://\(url)" : url, start, end, start)
            }
            cursor = end
        }
        push(slice(cursor, units.count), nil, cursor, units.count, cursor)
        return segments
    }

    /// A link's icon, fetched by the server from the page the link opens. See `docs/decisions/link-previews.md`.
    public static let faviconPath = "/api/favicon"


    /// The pasted text, trimmed, when it is one bare web URL and nothing else, the paste that becomes a titled link.
    public static func pastedUrl(_ pasted: String) -> String? {
        let text = UTF16Text.trim(pasted)
        let segments = linkify(text)
        guard segments.count == 1, let only = segments.first, only.href != nil, UTF16Text.equal(only.text, text) else { return nil }
        return text
    }

    /// `text` with the bare `url` pasted at `at` turned into `[title](url)`, once the page's title arrives. Nil when the
    /// text no longer holds that bare URL there, or the title leaves no label. Brackets in the title become parentheses,
    /// the only characters a Markdown label cannot hold.
    public static func titleLink(_ text: String, _ at: Int, _ url: String, _ title: String) -> String? {
        let bracketed = title.replacingOccurrences(of: "[", with: "(").replacingOccurrences(of: "]", with: ")")
        let label = UTF16Text.words(Array(bracketed.utf16)).filter { !$0.isEmpty }.map(UTF16Text.string).joined(separator: " ")
        let urlLength = url.utf16.count
        guard !label.isEmpty, let bare = linkify(text).first(where: { $0.start == at }), let href = bare.href,
              UTF16Text.equal(bare.text, url), bare.end == at + urlLength else { return nil }
        let units = Array(text.utf16)
        let link = "[\(label)](\(href))"
        let next = UTF16Text.string(units[..<at]) + link + UTF16Text.string(units[bare.end...])
        guard let titled = linkify(next).first(where: { $0.start == at }), UTF16Text.equal(titled.text, label),
              titled.end == at + link.utf16.count else { return nil }
        return next
    }
}
