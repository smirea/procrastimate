import Foundation

/// One drafted task from a ramble. Fields stay empty unless a spoken phrase set them. Subtasks nest under the task
/// they were spoken with, and `segment` is the transcript span the task came from, in UTF-16 offsets.
public struct RambleTask: Hashable, Sendable {
    public var segment: RambleSpan
    public var title: String
    public var notes: String
    public var due: Due?
    public var recurrence: Recurrence?
    public var priority: Priority?
    public var reminders: [Reminder]
    public var projectId: String?
    public var labelIds: [String]
    public var subtasks: [RambleTask]

    public init(
        segment: RambleSpan,
        title: String,
        notes: String = "",
        due: Due? = nil,
        recurrence: Recurrence? = nil,
        priority: Priority? = nil,
        reminders: [Reminder] = [],
        projectId: String? = nil,
        labelIds: [String] = [],
        subtasks: [RambleTask] = []
    ) {
        self.segment = segment
        self.title = title
        self.notes = notes
        self.due = due
        self.recurrence = recurrence
        self.priority = priority
        self.reminders = reminders
        self.projectId = projectId
        self.labelIds = labelIds
        self.subtasks = subtasks
    }
}

public struct RambleSpan: Codable, Hashable, Sendable {
    public var start: Int
    public var end: Int

    public init(start: Int, end: Int) {
        self.start = start
        self.end = end
    }
}

public struct RambleToken: Codable, Hashable, Sendable {
    public var kind: String
    public var start: Int
    public var end: Int
    public var text: String

    public init(kind: String, start: Int, end: Int, text: String) {
        self.kind = kind
        self.start = start
        self.end = end
        self.text = text
    }
}

public struct RambleDraft: Hashable, Sendable {
    public var tasks: [RambleTask]
    public var tokens: [RambleToken]
    public var ended: Bool

    public init(tasks: [RambleTask], tokens: [RambleToken], ended: Bool) {
        self.tasks = tasks
        self.tokens = tokens
        self.ended = ended
    }
}

extension RambleTask: Codable {
    enum CodingKeys: String, CodingKey {
        case segment, title, notes, due, recurrence, priority, reminders, projectId, labelIds, subtasks
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        segment = try c.decode(RambleSpan.self, forKey: .segment)
        title = try c.decode(String.self, forKey: .title)
        notes = try c.decode(String.self, forKey: .notes)
        due = try c.decode(Due?.self, forKey: .due)
        recurrence = try c.decode(Recurrence?.self, forKey: .recurrence)
        priority = try c.decode(Priority?.self, forKey: .priority)
        reminders = try c.decode([Reminder].self, forKey: .reminders)
        projectId = try c.decode(String?.self, forKey: .projectId)
        labelIds = try c.decode([String].self, forKey: .labelIds)
        subtasks = try c.decode([RambleTask].self, forKey: .subtasks)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(segment, forKey: .segment)
        try c.encode(title, forKey: .title)
        try c.encode(notes, forKey: .notes)
        try c.encode(due, forKey: .due)
        try c.encode(recurrence, forKey: .recurrence)
        try c.encode(priority, forKey: .priority)
        try c.encode(reminders, forKey: .reminders)
        try c.encode(projectId, forKey: .projectId)
        try c.encode(labelIds, forKey: .labelIds)
        try c.encode(subtasks, forKey: .subtasks)
    }
}

extension RambleDraft: Codable {
    enum CodingKeys: String, CodingKey {
        case tasks, tokens, ended
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        tasks = try c.decode([RambleTask].self, forKey: .tasks)
        tokens = try c.decode([RambleToken].self, forKey: .tokens)
        ended = try c.decode(Bool.self, forKey: .ended)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(tasks, forKey: .tasks)
        try c.encode(tokens, forKey: .tokens)
        try c.encode(ended, forKey: .ended)
    }
}

public enum Ramble {
    public static func parse(
        _ transcript: String,
        now: Date,
        projects: [Project] = [],
        labels: [Label] = [],
        in zone: TimeZone
    ) -> RambleDraft {
        var grammar = RambleGrammar(transcript: transcript, now: now, projects: projects, labels: labels, zone: zone)
        return grammar.parse()
    }
}


struct Mapped {
    var text: String
    var starts: [Int]
    var ends: [Int]
}

enum RambleNormalize {
    static let smallNumbers = [
        "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
        "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
    ]
    static let tens = ["twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60, "ninety": 90]
    static let digitWord = "one|two|three|four|five|six|seven|eight|nine"
    static let numberWord =
        "(?:(?:twenty|thirty|forty|fifty)(?:[\\s-](?:\(digitWord)))?|\(smallNumbers.reversed().joined(separator: "|"))|sixty|ninety)"
    static let hourWord = "(?:twelve|eleven|ten|\(digitWord))"
    static let ordinalKeys = [
        "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh",
        "twelfth", "thirteenth", "fourteenth", "fifteenth", "sixteenth", "seventeenth", "eighteenth", "nineteenth",
        "twentieth", "thirtieth",
    ]
    static let ordinalWords = Dictionary(uniqueKeysWithValues: zip(ordinalKeys, [
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 30,
    ]))
    static let ordinalWord =
        "(?:(?:twenty|thirty)[\\s-](?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth)|\(ordinalKeys.joined(separator: "|")))"
    static let dayName = "(?:mon|tues|wednes|thurs|fri|satur|sun)day"
    static let monthName = "(?:january|february|march|april|may|june|july|august|september|sept|october|november|december)"
    static let hour = "(?:\\d{1,2}|\(hourWord))"
    static let meridiemAhead = "(?=\\s*[ap]\\.?\\s?m\\b)"
    static let unitWord = "(?:minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?)"
    static let separator = "(?:next|new|another)\\s+task|next\\s+one|and\\s+another\\s+thing"
    static let time = "(?:\\d{1,2}(?::\\d{2})?[ap]m|noon|midnight)"
    static let when =
        "(?:(?:on|at|by|for|due)\\s+)?(?:(?:every|each)\\s+)?(?:today|tomorrow|tonight|eod|eow|next\\s+(?:week|month|\(dayName))|\(dayName)(?:\\s+and\\s+\(dayName))?|(?:the\\s+)?\\d{1,2}(?:st|nd|rd|th)|\(monthName)\\s+\\d{1,2}(?:st|nd|rd|th)?|\\d{1,2}(?::\\d{2})?[ap]m|noon|midnight|in\\s+\\d+\\s+\(unitWord))(?:\\s+(?:at\\s+)?(?:\\d{1,2}(?::\\d{2})?[ap]m|noon|midnight))?"
    static let priorityWords = "(?:priority\\s+[1-4]|p[1-4])"
    static let corrected =
        "\\s*,?\\s*(?:actually|no\\s+wait|wait|sorry|no|i\\s+mean|i\\s+meant|scratch\\s+that|or\\s+rather|rather)\\s*,?\\s*(?:(?:make|change)\\s+(?:that|it)(?:\\s+to)?\\s+|let's\\s+(?:say|do)\\s+)?"
    static let priorityLevels = [
        "one": 1, "two": 2, "three": 3, "four": 4, "won": 1, "to": 2, "too": 2, "for": 4, "fore": 4,
        "1": 1, "2": 2, "3": 3, "4": 4,
    ]
    static let sentencePeriod = RambleRegex(#"^(?:\s+[A-Z]|\s*$)"#)
    static let wordSplit = RambleRegex(#"[\s-]+"#)
    static let digitsOnly = RambleRegex(#"^\d+$"#)
    static let startsWithDigit = RambleRegex(#"^\d"#)

    static func numberValue(_ text: String) -> Int {
        wordSplit.split(rambleFold(text)).reduce(0) { sum, word in
            if let ten = tens[word] { return sum + ten }
            if let index = smallNumbers.firstIndex(of: word) { return sum + index }
            return sum - 1
        }
    }

    static func ordinalValue(_ text: String) -> Int {
        let folded = rambleFold(text)
        if startsWithDigit.test(folded) { return Int(folded.prefix { $0.isNumber }) ?? 0 }
        let words = wordSplit.split(folded)
        if words.count == 2 { return (tens[words[0]] ?? 0) + (ordinalWords[words[1]] ?? 0) }
        return ordinalWords[folded] ?? 0
    }

    static func ordinal(_ n: Int) -> String {
        let suffix =
            n % 10 == 1 && n != 11 ? "st"
            : n % 10 == 2 && n != 12 ? "nd"
            : n % 10 == 3 && n != 13 ? "rd" : "th"
        return "\(n)\(suffix)"
    }

    static func hourValue(_ text: String) -> Int {
        startsWithDigit.test(text) ? (Int(text) ?? 0) : numberValue(text)
    }

    static func identity(_ text: String) -> Mapped {
        let count = JSString(text).count
        let offsets = Array(0...count)
        return Mapped(text: text, starts: offsets, ends: offsets)
    }

    static func rewrite(_ source: Mapped, _ pattern: RambleRegex, _ replace: (RambleRegex.Found) -> String?) -> Mapped {
        var text = ""
        var starts: [Int] = []
        var ends = [source.ends[0]]
        var cursor = 0
        let src = JSString(source.text)
        func copy(to limit: Int) {
            while cursor < limit {
                text += src.char(cursor)
                starts.append(source.starts[cursor])
                ends.append(source.ends[cursor + 1])
                cursor += 1
            }
        }
        for match in pattern.matches(in: source.text) {
            if match.start < cursor { continue }
            guard let replacement = replace(match), replacement != match.value else { continue }
            copy(to: match.start)
            let written = JSString(replacement)
            for index in 0..<written.count {
                text += written.char(index)
                starts.append(source.starts[match.start])
                ends.append(source.ends[match.end])
            }
            cursor = match.end
        }
        copy(to: src.count)
        starts.append(source.starts[src.count])
        return Mapped(text: text, starts: starts, ends: ends)
    }

    static func normalize(_ transcript: String) -> Mapped {
        var mapped = identity(transcript)
        let steps: [(RambleRegex, (RambleRegex.Found) -> String?)] = [
            (RambleRegex("[’‘]"), { _ in "'" }),
            (RambleRegex(#"\bthe day after tomorrow\b"#, ignoreCase: true), { _ in "in 2 days" }),
            (RambleRegex(#"\b(?:(?:at|by)\s+)?(?:the\s+)?end of (?:the )?day\b"#, ignoreCase: true), { _ in "eod" }),
            (RambleRegex(#"\b(?:(?:at|by)\s+)?(?:the\s+)?end of (?:the )?week\b"#, ignoreCase: true), { _ in "eow" }),
            (RambleRegex(#"\bthis (?:morning|afternoon)\b"#, ignoreCase: true), { _ in "today" }),
            (RambleRegex(#"\bthis evening\b"#, ignoreCase: true), { _ in "tonight" }),
            (RambleRegex("\\b(today|tomorrow|\(dayName))\\s+(morning|afternoon|evening|night)\\b", ignoreCase: true), { match in
                guard let second = match[2], let first = match[1] else { return nil }
                return second.first?.isUppercase == true ? nil : first
            }),
            (RambleRegex("\\b(?:this\\s+(?:coming\\s+)?|coming\\s+)(\(dayName))\\b", ignoreCase: true), { $0[1] }),
            (RambleRegex("\\b(half past|quarter past|quarter to)\\s+(\(hour))\\b\(meridiemAhead)", ignoreCase: true), { match in
                guard let phrase = match[1], let hourText = match[2] else { return nil }
                let hour = hourValue(hourText)
                if hour < 1 || hour > 12 { return nil }
                let name = rambleFold(phrase)
                if name == "quarter to" { return "\(hour == 1 ? 12 : hour - 1):45" }
                return "\(hour):\(name == "half past" ? "30" : "15")"
            }),
            (RambleRegex("\\b(\(hourWord))(?:\\s+(oh\\s+(?:\(digitWord))|\(numberWord)))?\\b\(meridiemAhead)", ignoreCase: true), { match in
                guard let hourText = match[1] else { return nil }
                let hour = numberValue(hourText)
                guard let minutesText = match[2] else { return String(hour) }
                let minutes = numberValue(RambleRegex(#"^oh\s+"#, ignoreCase: true).replaceFirst(minutesText) { _ in "" })
                return minutes < 60 ? "\(hour):\(minutes < 10 ? "0\(minutes)" : "\(minutes)")" : nil
            }),
            (RambleRegex(#"\b(\d{1,2}(?::\d{2})?)\s*([ap])(?:\.\s?m\.?|\s?m\b)"#, ignoreCase: true), { match in
                guard let clock = match[1], let meridiem = match[2] else { return nil }
                let period = match.value.hasSuffix(".") && sentencePeriod.test(match.rest) ? "." : ""
                return "\(clock)\(rambleFold(meridiem))m\(period)"
            }),
            (RambleRegex(#"\bhalf an? hour\b"#, ignoreCase: true), { _ in "30 minutes" }),
            (RambleRegex("\\b(\(numberWord))(?=[\\s-]+\(unitWord)\\b)", ignoreCase: true), { match in
                match[1].map { String(numberValue($0)) }
            }),
            (RambleRegex(#"(?<=\bin\s+)an?(?=\s+(?:minute|hour|day|week|month|year)\b)"#, ignoreCase: true), { _ in "1" }),
            (RambleRegex(#"\ban?(?=\s+(?:minute|hour|day|week)\s+before\b)"#, ignoreCase: true), { _ in "1" }),
            (RambleRegex("\\b(\(monthName))\\s+(?:the\\s+)?(\(ordinalWord)|\\d{1,2}(?:st|nd|rd|th)?)\\b", ignoreCase: true), { match in
                guard let month = match[1], let day = match[2] else { return nil }
                let written = digitsOnly.test(day) ? day : ordinal(ordinalValue(day))
                return "\(month) \(written)"
            }),
            (RambleRegex("\\b(?:the\\s+)?(\(ordinalWord)|\\d{1,2}(?:st|nd|rd|th))\\s+of\\s+(\(monthName))\\b", ignoreCase: true), { match in
                guard let day = match[1], let month = match[2] else { return nil }
                return "\(ordinal(ordinalValue(day))) \(month)"
            }),
            (RambleRegex("(?<=\\bthe\\s+)(\(ordinalWord))\\b", ignoreCase: true), { match in
                match[1].map { ordinal(ordinalValue($0)) }
            }),
            (
                RambleRegex(
                    "(?<=\\b(?:today|tomorrow|tonight|\(dayName)|\\d(?:st|nd|rd|th)?))\\s*,(?=\\s+(?:at\\s+)?(?:\\d{1,2}(?::\\d{2})?[ap]m\\b|noon\\b|midnight\\b|\\d{1,2}:\\d{2}\\b))",
                    ignoreCase: true
                ),
                { _ in "" }
            ),
            (RambleRegex(#"\bpriority\s+(?:number\s+|level\s+)?(one|two|three|four|[1-4])\b(?![.:,]?\d)"#, ignoreCase: true), { match in
                match[1].flatMap { priorityLevels[rambleFold($0)] }.map { "priority \($0)" }
            }),
            (RambleRegex("\\bpriority\\s+(won|to|too|for|fore)\\b(?=\\s*(?:[.,;!?]|$|(?:\(separator))\\b))", ignoreCase: true), { match in
                match[1].flatMap { priorityLevels[rambleFold($0)] }.map { "priority \($0)" }
            }),
            (RambleRegex(#"\b(?:pee\s+(?:one|two|three|four|[1-4])|p\s+(?:one|two|three|four)|p-[1-4])\b"#, ignoreCase: true), { match in
                let parts = wordSplit.split(match.value)
                guard parts.count > 1, let level = priorityLevels[rambleFold(parts[1])] else { return nil }
                return "p\(level)"
            }),
            // A spoken correction keeps only the phrase it switches to: `Thursday, actually make that Friday` becomes `Friday`.
            (RambleRegex("\\b(?:at\\s+)?\(time)\(corrected)(?:at\\s+)?(\(time))(?![\\w:])", ignoreCase: true), { match in
                match[1].map { "at \($0)" }
            }),
            (RambleRegex("\\b\(when)\(corrected)(\(when))\\b", ignoreCase: true), { match in match[1] }),
            (RambleRegex("\\b\(priorityWords)\(corrected)(\(priorityWords))\\b", ignoreCase: true), { match in match[1] }),
        ]
        for (pattern, replace) in steps {
            mapped = rewrite(mapped, pattern, replace)
        }
        return mapped
    }
}
