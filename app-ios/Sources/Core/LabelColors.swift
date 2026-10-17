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

    /// Instructions for the on-device model that picks a new label's color on iOS, which `LabelColorModel` constrains
    /// to the palette. The meanings echo the hints above so a name both know gets the same color.
    public static let modelInstructions = """
    You pick a color for a label in a personal to-do app, from the label's name. Labels tag tasks across projects, \
    such as "calls", "waiting", or "groceries". Choose the color most people would associate with the name:
    red: urgent, problems, bugs, deadlines.
    orange: errands, shopping, food, cooking.
    amber: waiting, someday, maybe, later.
    lime: outdoors, sports, energy.
    green: money, finance, health, fitness, plants, garden.
    teal: travel, places, home.
    cyan: water, cleaning, tech.
    blue: work, calls, email, meetings, admin.
    indigo: focus, deep work, night, planning.
    violet: ideas, reading, learning, creative work.
    pink: family, friends, kids, people's names, gifts, love.
    gray: low priority, archive, reference, misc.
    A name that fits none of these still gets the closest color.
    """
}
