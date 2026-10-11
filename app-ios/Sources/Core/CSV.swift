import Foundation

/// The CSV reader of `shared/csv.ts`.
public enum CSV {
    /// Rows of an RFC 4180 CSV document. Quoted fields hold commas, doubled quotes, and line breaks. Line endings
    /// become `\n`, inside fields too, and a leading byte order mark is dropped.
    public static func parseCsv(_ text: String) -> [[String]] {
        var input = Array(text.unicodeScalars)
        if input.first == "\u{FEFF}" { input.removeFirst() }
        var rows: [[String]] = []
        var row: [String] = []
        var field = String.UnicodeScalarView()
        var quoted = false
        var i = 0
        while i < input.count {
            var char = input[i]
            if char == "\r" {
                if i + 1 < input.count, input[i + 1] == "\n" { i += 1 }
                char = "\n"
            }
            if quoted {
                if char != "\"" {
                    field.append(char)
                } else if i + 1 < input.count, input[i + 1] == "\"" {
                    field.append("\"")
                    i += 1
                } else {
                    quoted = false
                }
            } else if char == "\"", field.isEmpty {
                quoted = true
            } else if char == "," {
                row.append(String(field))
                field = String.UnicodeScalarView()
            } else if char == "\n" {
                row.append(String(field))
                rows.append(row)
                row = []
                field = String.UnicodeScalarView()
            } else {
                field.append(char)
            }
            i += 1
        }
        if !field.isEmpty || !row.isEmpty { rows.append(row + [String(field)]) }
        return rows
    }
}
