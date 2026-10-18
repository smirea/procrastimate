import Foundation

/// A JavaScript regular expression from `shared/ramble.ts`, run on ICU. `\w`, `\d`, `\s`, and `\b` match like
/// JavaScript, and `\p{…}` stays a Unicode property, including inside a class. Offsets are UTF-16.
struct RambleRegex: @unchecked Sendable {
    struct Found {
        let text: NSString
        let result: NSTextCheckingResult

        var start: Int { result.range.location }
        var end: Int { result.range.location + result.range.length }
        var value: String { text.substring(with: result.range) }
        var rest: String { text.substring(from: end) }

        subscript(_ index: Int) -> String? { group(result.range(at: index)) }
        subscript(_ name: String) -> String? { group(result.range(withName: name)) }

        /// A named group that took part in the match. An unmatched alternative is absent, not an empty string.
        func named(_ name: String) -> String? {
            guard let value = self[name], !value.isEmpty else { return nil }
            return value
        }

        private func group(_ range: NSRange) -> String? {
            range.location == NSNotFound ? nil : text.substring(with: range)
        }
    }

    private let regex: NSRegularExpression

    init(_ source: String, ignoreCase: Bool = false) {
        let pattern = Self.icu(source)
        do {
            regex = try NSRegularExpression(pattern: pattern, options: ignoreCase ? [.caseInsensitive] : [])
        } catch {
            preconditionFailure("Invalid pattern \(source) -> \(pattern): \(error)")
        }
    }

    func matches(in text: String) -> [Found] {
        let ns = text as NSString
        return regex.matches(in: text, range: NSRange(location: 0, length: ns.length)).map { Found(text: ns, result: $0) }
    }

    func first(in text: String) -> Found? {
        let ns = text as NSString
        return regex.firstMatch(in: text, range: NSRange(location: 0, length: ns.length)).map { Found(text: ns, result: $0) }
    }

    func test(_ text: String) -> Bool { first(in: text) != nil }

    func replace(_ text: String, _ transform: (Found) -> String) -> String {
        let ns = text as NSString
        var out = ""
        var cursor = 0
        for found in matches(in: text) {
            if found.start < cursor { continue }
            out += ns.substring(with: NSRange(location: cursor, length: found.start - cursor))
            out += transform(found)
            cursor = found.end
        }
        return out + ns.substring(from: cursor)
    }

    /// `String.replace` without the `g` flag: the first match only.
    func replaceFirst(_ text: String, _ transform: (Found) -> String) -> String {
        guard let found = first(in: text) else { return text }
        let ns = text as NSString
        return ns.substring(to: found.start) + transform(found) + ns.substring(from: found.end)
    }

    /// JavaScript `split`. A leading empty piece stays; trailing empty pieces do not.
    func split(_ text: String) -> [String] {
        let found = matches(in: text)
        if found.isEmpty { return [text] }
        let ns = text as NSString
        var parts: [String] = []
        var cursor = 0
        for match in found {
            if match.start < cursor { continue }
            parts.append(ns.substring(with: NSRange(location: cursor, length: match.start - cursor)))
            cursor = match.end
        }
        if cursor < ns.length { parts.append(ns.substring(from: cursor)) }
        while parts.last == "" { parts.removeLast() }
        return parts
    }

    private static func icu(_ source: String) -> String {
        let word = "A-Za-z0-9_"
        let space = #"\t\n\u000B\f\r \u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF"#
        let boundary = "(?:(?<=[\(word)])(?![\(word)])|(?<![\(word)])(?=[\(word)]))"
        let chars = Array(source)
        var out = ""
        var inClass = false
        var groups: [Bool] = []
        var lookbehinds = 0
        var i = 0
        while i < chars.count {
            let c = chars[i]
            i += 1
            if c == "\\", i < chars.count {
                let escaped = chars[i]
                i += 1
                if escaped == "p" || escaped == "P" {
                    out.append("\\")
                    out.append(escaped)
                    if i < chars.count, chars[i] == "{" {
                        while i < chars.count {
                            let piece = chars[i]
                            i += 1
                            out.append(piece)
                            if piece == "}" { break }
                        }
                    }
                    continue
                }
                switch escaped {
                case "w": out += inClass ? word : "[\(word)]"
                case "d": out += inClass ? "0-9" : "[0-9]"
                case "s": out += inClass ? space : "[\(space)]"
                case "W": out += "[^\(word)]"
                case "D": out += "[^0-9]"
                case "S": out += "[^\(space)]"
                case "b": out += boundary
                default: out += "\\\(escaped)"
                }
                continue
            }
            if inClass {
                if c == "]" { inClass = false }
                if "[{}&".contains(c) { out.append("\\") }
                out.append(c)
                continue
            }
            switch c {
            case "[":
                inClass = true
                out.append(c)
            case "(":
                let lookbehind = i + 2 < chars.count && chars[i] == "?" && chars[i + 1] == "<"
                    && (chars[i + 2] == "=" || chars[i + 2] == "!")
                groups.append(lookbehind)
                if lookbehind { lookbehinds += 1 }
                out.append(c)
            case ")":
                if groups.popLast() == true { lookbehinds -= 1 }
                out.append(c)
            case "+" where lookbehinds > 0: out += "{1,64}"
            case "*" where lookbehinds > 0: out += "{0,64}"
            case "$": out += #"\z"#
            default: out.append(c)
            }
        }
        return out
    }
}

/// A JavaScript string: indexes and slices count UTF-16 code units, which is what the grammar's offsets are.
struct JSString {
    let ns: NSString

    init(_ value: String) { ns = value as NSString }

    var count: Int { ns.length }

    func slice(_ start: Int, _ end: Int) -> String {
        let lower = min(max(start, 0), count)
        let upper = min(max(end, lower), count)
        if upper == lower { return "" }
        return ns.substring(with: NSRange(location: lower, length: upper - lower))
    }

    func unit(_ index: Int) -> UInt16 {
        ns.character(at: index)
    }
}

func rambleFold(_ text: String) -> String {
    text.lowercased(with: Locale(identifier: "en_US_POSIX"))
}

func rambleCapitalize(_ text: String) -> String {
    let js = JSString(text)
    guard js.count > 0 else { return "" }
    let first = js.unit(0)
    if UTF16.isLeadSurrogate(first) || UTF16.isTrailSurrogate(first) { return text }
    return js.slice(0, 1).uppercased(with: Locale(identifier: "en_US_POSIX")) + js.slice(1, js.count)
}
