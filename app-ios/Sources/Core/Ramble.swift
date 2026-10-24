import Foundation

public typealias RambleTask = API.RambleTask
public typealias RambleSpan = API.RambleSpan
public typealias RambleToken = API.RambleToken
public typealias RambleTokenKind = API.RambleTokenKind
public typealias RambleDraft = API.RambleDraft
public typealias RambleOutline = API.RambleOutline
public typealias RambleOutlineTask = API.RambleOutlineTask

public enum Ramble {
    public static func parse(
        _ transcript: String,
        now: Date,
        projects: [Project] = [],
        labels: [Label] = [],
        in zone: TimeZone,
        commands: Bool = false
    ) -> RambleDraft {
        var grammar = RambleGrammar(transcript: transcript, now: now, projects: projects, labels: labels, zone: zone, commands: commands)
        return grammar.parse()
    }

    private static let remindMe = JSRegex(#"^remind\s+me\s+"#, ignoreCase: true)

    /// `resolveOutline` in `shared/ramble.ts`: phrases go through quick add, and names match existing projects and
    /// labels the way the grammar matches them, so an unknown name sets nothing.
    public static func resolveOutline(
        _ outline: RambleOutline,
        now: Date,
        projects: [Project] = [],
        labels: [Label] = [],
        in zone: TimeZone
    ) -> [RambleTask] {
        let projectIds = Dictionary(projects.map { (RambleNames.key($0.name), $0.id) }, uniquingKeysWith: { _, last in last })
        let labelIds = Dictionary(labels.map { (RambleNames.key($0.name), $0.id) }, uniquingKeysWith: { _, last in last })
        func trim(_ text: String) -> String { text.trimmingCharacters(in: .whitespacesAndNewlines) }
        func resolve(_ task: RambleOutlineTask, _ isRoot: Bool) -> RambleTask? {
            let title = trim(task.title)
            if title.isEmpty { return nil }
            let reminder = trim(task.reminder)
            let phrase = [trim(task.when), reminder.isEmpty ? "" : "remind me \(remindMe.replaceFirst(reminder) { _ in "" })"]
                .filter { !$0.isEmpty }
                .joined(separator: " ")
            let parsed = phrase.isEmpty ? nil : QuickAdd.parse(phrase, QuickAdd.Options(now: now), in: zone)
            var ids: [String] = []
            for name in task.labels {
                if let id = labelIds[RambleNames.key(name)], !ids.contains(id) { ids.append(id) }
            }
            return RambleTask(
                segment: RambleSpan(start: 0, end: 0),
                title: rambleCapitalize(title),
                notes: trim(task.notes),
                due: parsed?.due,
                recurrence: parsed?.recurrence,
                priority: (1 ... 4).contains(task.priority) ? Priority(rawValue: task.priority) : nil,
                reminders: parsed?.reminders ?? [],
                projectId: isRoot ? projectIds[RambleNames.key(task.project)] : nil,
                labelIds: ids,
                subtasks: task.subtasks.compactMap { resolve($0, false) }
            )
        }
        return outline.tasks.compactMap { resolve($0, true) }
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
    static let sentencePeriod = JSRegex(#"^(?:\s+[A-Z]|\s*$)"#)
    static let wordSplit = JSRegex(#"[\s-]+"#)
    static let digitsOnly = JSRegex(#"^\d+$"#)
    static let startsWithDigit = JSRegex(#"^\d"#)

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

    static func rewrite(_ source: Mapped, _ pattern: JSRegex, _ replace: (JSRegex.Found) -> String?) -> Mapped {
        var units: [UInt16] = []
        var starts: [Int] = []
        var ends = [source.ends[0]]
        var cursor = 0
        let src = JSString(source.text)
        func copy(to limit: Int) {
            while cursor < limit {
                units.append(src.unit(cursor))
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
                units.append(written.unit(index))
                starts.append(source.starts[match.start])
                ends.append(source.ends[match.end])
            }
            cursor = match.end
        }
        copy(to: src.count)
        starts.append(source.starts[src.count])
        return Mapped(text: String(decoding: units, as: UTF16.self), starts: starts, ends: ends)
    }

    static let leadingOh = JSRegex(#"^oh\s+"#, ignoreCase: true)

    static func normalize(_ transcript: String) -> Mapped {
        var mapped = identity(transcript)
        for (pattern, replace) in steps { mapped = rewrite(mapped, pattern, replace) }
        return mapped
    }

    static let steps: [(JSRegex, @Sendable (JSRegex.Found) -> String?)] = [
            (JSRegex("[’‘]"), { _ in "'" }),
            (JSRegex(#"\bthe day after tomorrow\b"#, ignoreCase: true), { _ in "in 2 days" }),
            (JSRegex(#"\b(?:(?:at|by)\s+)?(?:the\s+)?end of (?:the )?day\b"#, ignoreCase: true), { _ in "eod" }),
            (JSRegex(#"\b(?:(?:at|by)\s+)?(?:the\s+)?end of (?:the )?week\b"#, ignoreCase: true), { _ in "eow" }),
            (JSRegex(#"\bthis (?:morning|afternoon)\b"#, ignoreCase: true), { _ in "today" }),
            (JSRegex(#"\bthis evening\b"#, ignoreCase: true), { _ in "tonight" }),
            (JSRegex("\\b(today|tomorrow|\(dayName))\\s+(morning|afternoon|evening|night)\\b", ignoreCase: true), { match in
                guard let second = match[2], let first = match[1] else { return nil }
                return second.first?.isUppercase == true ? nil : first
            }),
            (JSRegex("\\b(?:this\\s+(?:coming\\s+)?|coming\\s+)(\(dayName))\\b", ignoreCase: true), { $0[1] }),
            (JSRegex("\\b(half past|quarter past|quarter to)\\s+(\(hour))\\b\(meridiemAhead)", ignoreCase: true), { match in
                guard let phrase = match[1], let hourText = match[2] else { return nil }
                let hour = hourValue(hourText)
                if hour < 1 || hour > 12 { return nil }
                let name = rambleFold(phrase)
                if name == "quarter to" { return "\(hour == 1 ? 12 : hour - 1):45" }
                return "\(hour):\(name == "half past" ? "30" : "15")"
            }),
            (JSRegex("\\b(\(hourWord))(?:\\s+(oh\\s+(?:\(digitWord))|\(numberWord)))?\\b\(meridiemAhead)", ignoreCase: true), { match in
                guard let hourText = match[1] else { return nil }
                let hour = numberValue(hourText)
                guard let minutesText = match[2] else { return String(hour) }
                let minutes = numberValue(leadingOh.replaceFirst(minutesText) { _ in "" })
                return minutes < 60 ? "\(hour):\(minutes < 10 ? "0\(minutes)" : "\(minutes)")" : nil
            }),
            (JSRegex(#"\b(\d{1,2}(?::\d{2})?)\s*([ap])(?:\.\s?m\.?|\s?m\b)"#, ignoreCase: true), { match in
                guard let clock = match[1], let meridiem = match[2] else { return nil }
                let period = match.value.hasSuffix(".") && sentencePeriod.test(match.rest) ? "." : ""
                return "\(clock)\(rambleFold(meridiem))m\(period)"
            }),
            (JSRegex(#"\bhalf an? hour\b"#, ignoreCase: true), { _ in "30 minutes" }),
            (JSRegex("\\b(\(numberWord))(?=[\\s-]+\(unitWord)\\b)", ignoreCase: true), { match in
                match[1].map { String(numberValue($0)) }
            }),
            (JSRegex(#"(?<=\bin\s+)an?(?=\s+(?:minute|hour|day|week|month|year)\b)"#, ignoreCase: true), { _ in "1" }),
            (JSRegex(#"\ban?(?=\s+(?:minute|hour|day|week)\s+before\b)"#, ignoreCase: true), { _ in "1" }),
            (JSRegex("\\b(\(monthName))\\s+(?:the\\s+)?(\(ordinalWord)|\\d{1,2}(?:st|nd|rd|th)?)\\b", ignoreCase: true), { match in
                guard let month = match[1], let day = match[2] else { return nil }
                let written = digitsOnly.test(day) ? day : ordinal(ordinalValue(day))
                return "\(month) \(written)"
            }),
            (JSRegex("\\b(?:the\\s+)?(\(ordinalWord)|\\d{1,2}(?:st|nd|rd|th))\\s+of\\s+(\(monthName))\\b", ignoreCase: true), { match in
                guard let day = match[1], let month = match[2] else { return nil }
                return "\(ordinal(ordinalValue(day))) \(month)"
            }),
            (JSRegex("(?<=\\bthe\\s+)(\(ordinalWord))\\b", ignoreCase: true), { match in
                match[1].map { ordinal(ordinalValue($0)) }
            }),
            (
                JSRegex(
                    "(?<=\\b(?:today|tomorrow|tonight|\(dayName)|\\d(?:st|nd|rd|th)?))\\s*,(?=\\s+(?:at\\s+)?(?:\\d{1,2}(?::\\d{2})?[ap]m\\b|noon\\b|midnight\\b|\\d{1,2}:\\d{2}\\b))",
                    ignoreCase: true
                ),
                { _ in "" }
            ),
            (JSRegex(#"\bpriority\s+(?:number\s+|level\s+)?(one|two|three|four|[1-4])\b(?![.:,]?\d)"#, ignoreCase: true), { match in
                match[1].flatMap { priorityLevels[rambleFold($0)] }.map { "p\($0)" }
            }),
            (JSRegex("\\bpriority\\s+(won|to|too|for|fore)\\b(?=\\s*(?:[.,;!?]|$|(?:\(separator))\\b))", ignoreCase: true), { match in
                match[1].flatMap { priorityLevels[rambleFold($0)] }.map { "p\($0)" }
            }),
            (JSRegex(#"\b(?:pee\s+(?:one|two|three|four|[1-4])|p\s+(?:one|two|three|four)|p-[1-4])\b"#, ignoreCase: true), { match in
                let parts = wordSplit.split(match.value)
                guard parts.count > 1, let level = priorityLevels[rambleFold(parts[1])] else { return nil }
                return "p\(level)"
            }),
            // A spoken correction keeps only the phrase it switches to: `Thursday, actually make that Friday` becomes `Friday`.
            (JSRegex("\\b(?:at\\s+)?\(time)\(corrected)(?:at\\s+)?(\(time))(?![\\w:])", ignoreCase: true), { match in
                match[1].map { "at \($0)" }
            }),
            (JSRegex("\\b\(when)\(corrected)(\(when))\\b", ignoreCase: true), { match in match[1] }),
            (JSRegex("\\b\(priorityWords)\(corrected)(\(priorityWords))\\b", ignoreCase: true), { match in match[1] }),
        ]
}
