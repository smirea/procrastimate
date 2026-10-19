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
}
