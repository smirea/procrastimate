import Foundation

extension QuickAdd {
    /// A JavaScript regular expression, as `shared/quick-add.ts` writes it, run on ICU through `NSRegularExpression`.
    /// The source is translated so it matches like JavaScript without the `u` flag: `\w`, `\d`, and `\b` are ASCII,
    /// `\s` is JavaScript's whitespace set, and `$` is the end of the input. ICU rejects an unbounded lookbehind, so a
    /// `+` or `*` inside one is capped at `lookbehindLimit` characters, which a title never reaches.
    /// Offsets are UTF-16, like JavaScript string indices.
    struct Pattern: @unchecked Sendable {
        static let lookbehindLimit = 64

        private let regex: NSRegularExpression

        init(_ source: String, ignoreCase: Bool = false) {
            do {
                regex = try NSRegularExpression(
                    pattern: Self.icu(source),
                    options: ignoreCase ? [.caseInsensitive] : []
                )
            } catch {
                preconditionFailure("Invalid pattern \(source): \(error)")
            }
        }

        func matches(in text: String) -> [Found] {
            let ns = NSString(string: text)
            return regex.matches(in: text, range: NSRange(location: 0, length: ns.length)).map { Found(text: ns, result: $0) }
        }

        func first(in text: String) -> Found? {
            let ns = NSString(string: text)
            return regex.firstMatch(in: text, range: NSRange(location: 0, length: ns.length)).map { Found(text: ns, result: $0) }
        }

        func test(_ text: String) -> Bool { first(in: text) != nil }

        /// `text.replace(pattern, transform)` with a global pattern.
        func replace(_ text: String, _ transform: (Found) -> String) -> String {
            let ns = NSString(string: text)
            var out = ""
            var cursor = 0
            for found in matches(in: text) {
                out += ns.substring(with: NSRange(location: cursor, length: found.start - cursor))
                out += transform(found)
                cursor = found.end
            }
            return out + ns.substring(from: cursor)
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
                    precondition(!inClass || !"WDSb".contains(escaped), "\\\(escaped) inside a class: \(source)")
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
                    // ICU reads these as set syntax inside a class, where JavaScript reads them literally.
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
                case "+" where lookbehinds > 0: out += "{1,\(lookbehindLimit)}"
                case "*" where lookbehinds > 0: out += "{0,\(lookbehindLimit)}"
                case "$": out += #"\z"#
                default: out.append(c)
                }
            }
            return out
        }
    }

    struct Found {
        let text: NSString
        let result: NSTextCheckingResult

        var start: Int { result.range.location }
        var end: Int { result.range.location + result.range.length }
        var value: String { text.substring(with: result.range) }

        subscript(_ index: Int) -> String? { group(result.range(at: index)) }
        subscript(_ name: String) -> String? { group(result.range(withName: name)) }

        private func group(_ range: NSRange) -> String? {
            range.location == NSNotFound ? nil : text.substring(with: range)
        }
    }
}
