import Foundation

public typealias LabelColor = API.LabelColor

public enum LabelColors {
    private static let hints: [String: LabelColor] = {
        let table: [(LabelColor, [String])] = [
            (.red, ["bug", "bugs", "urgent", "asap", "blocker", "important"]),
            (.orange, ["errand", "errands", "shopping", "groceries"]),
            (.amber, ["waiting", "wait", "someday", "maybe", "later"]),
            (.green, ["money", "finance", "bills", "health", "gym", "fitness", "garden"]),
            (.blue, ["work", "call", "calls", "phone", "email", "meeting", "meetings"]),
            (.violet, ["idea", "ideas", "read", "reading", "learn"]),
            (.pink, ["family", "kids", "gift", "gifts", "friends"]),
        ]
        return Dictionary(uniqueKeysWithValues: table.flatMap { color, words in words.map { ($0, color) } })
    }()

    private static let hashed = LabelColor.allCases.filter { $0 != .gray }

    /// A hint when a word of the name has an obvious color, or else a stable FNV-1a hash of the lowercased name over
    /// UTF-16 code units, matching `shared/label-colors.ts` so every client picks the same color.
    public static func defaultLabelColor(_ name: String) -> LabelColor {
        let key = name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        for word in key.components(separatedBy: CharacterSet.alphanumerics.inverted) {
            if let hinted = hints[word] { return hinted }
        }
        var hash: UInt32 = 0x811C_9DC5
        for unit in key.utf16 { hash = (hash ^ UInt32(unit)) &* 0x0100_0193 }
        return hashed[Int(hash % UInt32(hashed.count))]
    }
}
