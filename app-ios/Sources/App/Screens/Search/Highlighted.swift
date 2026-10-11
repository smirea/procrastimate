import Core
import SwiftUI

extension Search.Highlight {
    /// The text with each matched span on the `tokenMatch` highlight. Ranges count UTF-16 code units, as on the web.
    var attributed: AttributedString {
        let units = Array(text.utf16)
        var out = AttributedString()
        var cursor = 0
        for range in ranges {
            if range.lowerBound > cursor { out += AttributedString(Self.string(units[cursor..<range.lowerBound])) }
            var match = AttributedString(Self.string(units[range]))
            match.backgroundColor = .tokenMatch
            out += match
            cursor = range.upperBound
        }
        out += AttributedString(Self.string(units[min(cursor, units.count)...]))
        return out
    }

    /// The matched spans, which the result's accessibility value reads out since XCUITest cannot see the highlight.
    var matched: [String] {
        let units = Array(text.utf16)
        return ranges.map { Self.string(units[$0]) }
    }

    private static func string(_ units: ArraySlice<UInt16>) -> String { String(decoding: units, as: UTF16.self) }
}
