import Foundation

/// JavaScript string semantics for the ports of `shared/` text code. Offsets count UTF-16 code units, whitespace is
/// JavaScript's `\s`, and equality is by code unit rather than Swift's canonical equivalence, so every index, match,
/// and tie agrees with the web.
enum UTF16Text {
    static func isWhitespace(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar.value {
        case 0x09...0x0D, 0x20, 0xA0, 0x1680, 0x2000...0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF: true
        default: false
        }
    }

    /// Every JavaScript whitespace character is a single UTF-16 unit, so a lone surrogate is never whitespace.
    static func isWhitespace(_ unit: UInt16) -> Bool {
        Unicode.Scalar(unit).map(isWhitespace) ?? false
    }

    /// `/[\p{L}\p{N}]/u`.
    static func isLetterOrNumber(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar.properties.generalCategory {
        case .uppercaseLetter, .lowercaseLetter, .titlecaseLetter, .modifierLetter, .otherLetter,
             .decimalNumber, .letterNumber, .otherNumber:
            true
        default: false
        }
    }

    static func isMark(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar.properties.generalCategory {
        case .nonspacingMark, .spacingMark, .enclosingMark: true
        default: false
        }
    }

    /// `String#trim`.
    static func trim(_ text: String) -> String {
        let scalars = text.unicodeScalars
        guard let first = scalars.firstIndex(where: { !isWhitespace($0) }),
              let last = scalars.lastIndex(where: { !isWhitespace($0) })
        else { return "" }
        return String(scalars[first...last])
    }

    static func string(_ units: some Sequence<UInt16>) -> String { String(decoding: Array(units), as: UTF16.self) }

    static func equal(_ a: String, _ b: String) -> Bool { a.utf16.elementsEqual(b.utf16) }

    static func hasPrefix(_ text: some Collection<UInt16>, _ prefix: some Collection<UInt16>) -> Bool {
        text.starts(with: prefix)
    }

    /// `String#indexOf`: the first occurrence of `needle` at or after `from`.
    static func indexOf(_ haystack: [UInt16], _ needle: [UInt16], from: Int = 0) -> Int? {
        guard needle.count <= haystack.count else { return nil }
        var at = max(from, 0)
        while at + needle.count <= haystack.count {
            if haystack[at] == needle[0], haystack[at..<(at + needle.count)].elementsEqual(needle) { return at }
            at += 1
        }
        return nil
    }

    static func contains(_ haystack: [UInt16], _ needle: [UInt16]) -> Bool {
        needle.isEmpty || indexOf(haystack, needle) != nil
    }

    /// Splits on runs of whitespace, like `split(/\s+/)`.
    static func words(_ units: [UInt16]) -> [ArraySlice<UInt16>] {
        units.split(omittingEmptySubsequences: false, whereSeparator: isWhitespace)
    }

    /// `a.localeCompare(b, undefined, { sensitivity: 'base' })`: case and accents do not count, so names that differ
    /// only in them tie and keep their order.
    static func compareBase(_ a: String, _ b: String) -> ComparisonResult {
        a.compare(b, options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "en_US"))
    }
}
