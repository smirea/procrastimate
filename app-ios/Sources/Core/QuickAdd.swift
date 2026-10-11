import Foundation

/// The quick add parser of `shared/quick-add.ts`: one line of text becomes a title plus a due date, repeat, priority,
/// reminders, project, and labels. The patterns are the TS source's, translated by `QuickAdd.Pattern`, so a rule change
/// on either side reads the same. The rules and their reasons are in `docs/decisions/quick-add.md`.
public enum QuickAdd {
    public enum TokenKind: String, Codable, Sendable {
        case due, recurrence, priority, reminder, project, label
    }

    /// A recognized phrase, highlighted in the input. `start` and `end` are UTF-16 offsets, like JavaScript's.
    public struct Token: Hashable, Codable, Sendable {
        public var kind: TokenKind
        public var start: Int
        public var end: Int
        public var text: String
    }

    public struct Parsed: Hashable, Sendable, Encodable {
        public var title: String
        public var due: Due?
        public var recurrence: Recurrence?
        public var priority: Priority?
        public var reminders: [Reminder]
        public var projectId: String?
        public var labelIds: [String]
        public var tokens: [Token]

        private enum CodingKeys: String, CodingKey {
            case title, due, recurrence, priority, reminders, projectId, labelIds, tokens
        }

        public func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            try c.encode(title, forKey: .title)
            try c.encode(due, forKey: .due)
            try c.encode(recurrence, forKey: .recurrence)
            try c.encode(priority, forKey: .priority)
            try c.encode(reminders, forKey: .reminders)
            try c.encode(projectId, forKey: .projectId)
            try c.encode(labelIds, forKey: .labelIds)
            try c.encode(tokens, forKey: .tokens)
        }
    }

    public struct Options: Sendable {
        public var now: Date
        public var projects: [Project]
        public var labels: [Label]
        /// Token texts the user chose to keep as plain title text, compared case-insensitively.
        public var disabled: [String]
        /// The due date set outside the text, such as by a picker or on an existing task.
        public var due: Due?

        public init(now: Date, projects: [Project] = [], labels: [Label] = [], disabled: [String] = [], due: Due? = nil) {
            self.now = now
            self.projects = projects
            self.labels = labels
            self.disabled = disabled
            self.due = due
        }
    }

    // MARK: Patterns

    static let weekdayNames = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]
    static let monthNames = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]

    static let weekday =
        #"(?:mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)"#
    /// Two or more weekdays joined by spaces, commas, slashes, `and`, or `&`, as in `mon, wed and fri`.
    static let weekdaySeparator = #"(?:\s*[,/&]\s*(?:and\s+)?|\s+(?:and\s+)?)"#
    static let weekdayList = #"\#(weekday)\b(?:\#(weekdaySeparator)\#(weekday)\b)+"#
    static let slashedWeekdays = Pattern(#"^\#(weekday)(?:\s*/\s*\#(weekday))+$"#, ignoreCase: true)
    static let weekdayWord = Pattern(weekday, ignoreCase: true)
    static let month =
        #"(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)"#
    static let ordinal = #"\d{1,2}(?:st|nd|rd|th)?"#
    /// `mo` is listed before `m` everywhere, so months never read as minutes.
    static let dayUnit = #"(?:d(?:ays?)?|w(?:ks?|eeks?)?|mo(?:s|nths?)?|y(?:rs?|ears?)?)"#
    static let clockUnit = #"(?:m(?:ins?|inutes?)?|h(?:rs?|ours?)?)"#
    static let beforeUnit = #"(?:m(?:ins?|inutes?)?|h(?:rs?|ours?)?|d(?:ays?)?|w(?:ks?|eeks?)?)"#

    static let date = [
        "today|tonight|tomorrow|tmrw?|tom|eod|eow",
        #"(?:next|nxt)\s+(?:week|\#(weekday))"#,
        weekday,
        #"in\s+\d+\s*\#(dayUnit)"#,
        #"\d+(?:d|wks?|w|mos?)"#,
        #"\#(month)\s+\#(ordinal)(?:,?\s+(?:19|20)\d\d)?"#,
        #"\#(ordinal)\s+\#(month)(?:,?\s+(?:19|20)\d\d)?"#,
        #"the\s+\d{1,2}(?:st|nd|rd|th)"#,
        #"\d{1,2}/\d{1,2}(?:/(?:\d{4}|\d{2}))?"#,
    ].joined(separator: "|")
    /// A bare four-digit 19xx or 20xx reads as a year unless `at` comes first.
    static let time =
        #"noon|midnight|\d{1,2}(?::\d{2})?(?:\s*[ap]m|[ap])|\d{1,2}:\d{2}|(?<=\bat\s+)\d{4}|(?!(?:19|20)\d\d)\d{4}"#
    /// Minutes and hours from now. A spelled-out unit needs `in`, since `study 2 hours` is a length, not a time.
    static let moment = #"in\s+\d+(?:\s*\#(clockUnit))?|\d+\#(clockUnit)|\d+\s+(?:mins?|hrs?)"#
    static let dateTime =
        #"(?:(?:on\s+)?(?<date1>\#(date))(?:\s+(?:at\s+)?(?<time1>\#(time)))?|(?:at\s+)?(?<time2>\#(time))(?:\s+(?:on\s+)?(?<date2>\#(date)))?|(?<moment>\#(moment)))"#

    /// `#` and `@` start a name or a handle, so `@5pm` and `@tom` stay text.
    static let before = #"(?<![\w#@!$€£]|\d[/:.])"#
    static let after = #"(?![\w!]|[/:]\d)"#

    static let nameContext = "call|text|email|ping|ask|tell|meet|see|visit|thank|invite|message|dm|cc|with|and|to|for|from"
    static let phraseWords = "at|noon|midnight|tonight|remind|every|urgent|important|\(weekday)|\(month)"
    static let address = "apt|apartment|unit|suite|ste|flat|room|rm|floor|fl|bldg|building|box"
    static let street =
        "st|street|ave|avenue|rd|road|blvd|boulevard|ln|lane|drive|ct|court|pl|place|sq|square|hwy|pkwy|terrace|way"

    /// Context guards for words that are also ordinary title text. Each match is masked out before the date,
    /// recurrence, and reminder rules run, so those rules never see it.
    static let guards: [Pattern] = [
        Pattern(#"\b(?!tom\b)[Tt][Oo][Mm]\b"#),
        Pattern(#"(?<=\b(?:\#(nameContext))\s+)tom\b"#, ignoreCase: true),
        Pattern(
            #"(?<!\#(weekday)\b\#(weekdaySeparator))\b(?:tom|sun|sat|wed|daily|weekdays|weekly|monthly|yearly)\b(?=\s+(?!(?:\#(phraseWords)|and\s+\#(weekday))\b)[a-z]+(?![\w'’]))"#,
            ignoreCase: true
        ),
        Pattern(#"(?<=\b(?:\#(address))\.?\s+)\d[\w:/]*"#, ignoreCase: true),
        Pattern(#"(?<!\w)\d[\w:/]*(?=\s+(?:[\w.]+\s+)?(?:\#(street))\b)"#, ignoreCase: true),
    ]

    /// A weekday list repeats after `every`, next to a time, or when slashed, as in `tue/thu`. Anywhere else, as in
    /// `discuss mon wed plan`, the whole list stays text, since no single day is meant.
    static let weekdayListContext = Pattern(
        #"(?<lead>\b(?:every|each)\s+|(?<![\w:/.$€£])(?:at\s+)?(?:\#(time))\s+(?:on\s+)?)?(?<![\w#!$€£]|\d[/:.])(?<list>\#(weekdayList))(?<trail>\s+(?:at\s+)?(?:\#(time))(?![\w!]|[/:]\d))?"#,
        ignoreCase: true
    )

    static let whitespace = Pattern(#"\s+"#)

    static func mask(_ text: String) -> String { String(repeating: "_", count: text.utf16.count) }

    static func maskProseWeekdayLists(_ text: String) -> String {
        weekdayListContext.replace(text) { found in
            let list = found["list"] ?? ""
            let keep = !(found["lead"] ?? "").isEmpty || !(found["trail"] ?? "").isEmpty || slashedWeekdays.test(list)
            return keep ? found.value : mask(found.value)
        }
    }

    static func maskGuarded(_ input: String) -> String {
        guards.reduce(maskProseWeekdayLists(input)) { text, guardPattern in guardPattern.replace(text) { mask($0.value) } }
    }

    // MARK: Phrases

    struct Context {
        let now: Date
        let zone: TimeZone
        let today: DateKey
        let time: TimeOfDay
    }

    /// A due phrase. A nil date means only a time was typed.
    struct DuePhrase {
        var date: DateKey?
        var time: TimeOfDay?
    }

    /// A weekday repeat such as `every mon` anchors the first occurrence to that weekday.
    struct RecurrencePhrase {
        var recurrence: Recurrence
        var anchor: DateKey?
    }

    /// An absolute reminder may omit its date or time until the task's due date is known.
    enum ReminderDraft {
        case before(minutes: Int)
        case at(date: DateKey?, time: TimeOfDay?)
    }

    enum Match {
        case due(DuePhrase)
        case recurrence(RecurrencePhrase)
        case priority(Priority)
        case project(String)
        case label(String)
        case reminder(ReminderDraft)
    }

    struct Rule: Sendable {
        let kind: TokenKind
        let pattern: Pattern
        let repeatable: Bool
        /// Runs on the input with `guards` masked out.
        let guarded: Bool
        let read: @Sendable (Found, Context) -> Match?
    }

    enum DurationUnit {
        case minute, hour, recurring(RecurrenceUnit)

        var minutes: Int? {
            switch self {
            case .minute: return 1
            case .hour: return 60
            case .recurring(.day): return 1440
            case .recurring(.week): return 10_080
            case .recurring(.weekday), .recurring(.month), .recurring(.year): return nil
            }
        }

        var recurrenceUnit: RecurrenceUnit? {
            if case let .recurring(unit) = self { return unit }
            return nil
        }
    }

    static func unitOf(_ text: String) -> DurationUnit? {
        let t = text.lowercased()
        if t.hasPrefix("mo") { return .recurring(.month) }
        switch t.first {
        case "m": return .minute
        case "h": return .hour
        case "d": return .recurring(.day)
        case "w": return .recurring(.week)
        case "y": return .recurring(.year)
        default: return nil
        }
    }

    static func number(_ text: String?) -> Int? { text.flatMap { Int($0) } }

    static let timeShape = Pattern(#"^(\d{1,2}):?(\d{2})?(?:([ap])m?)?$"#)

    static func resolveTime(_ text: String) -> TimeOfDay? {
        let t = whitespace.replace(text.lowercased()) { _ in "" }
        if t == "noon" { return Dates.toTimeOfDay(hours: 12, minutes: 0) }
        if t == "midnight" { return Dates.toTimeOfDay(hours: 0, minutes: 0) }
        guard let m = timeShape.first(in: t), var hours = number(m[1]) else { return nil }
        let minutes = number(m[2]) ?? 0
        if minutes > 59 { return nil }
        if let meridiem = m[3] {
            if hours < 1 || hours > 12 { return nil }
            hours = hours % 12 + (meridiem == "p" ? 12 : 0)
        } else if hours > 23 {
            return nil
        }
        return Dates.toTimeOfDay(hours: hours, minutes: minutes)
    }

    static func prefixIndex(_ names: [String], _ text: String) -> Int {
        names.firstIndex(of: String(text.prefix(3))) ?? -1
    }

    static func weekdayIndex(_ text: String) -> Int { prefixIndex(weekdayNames, text) }
    static func monthIndex(_ text: String) -> Int { prefixIndex(monthNames, text) }

    /// The next date on that weekday, counting today.
    static func nextWeekday(_ today: DateKey, _ weekday: Weekday) -> DateKey {
        Dates.addDays(today, ((weekday - Dates.weekdayOf(today)) % 7 + 7) % 7)
    }

    static func daysToNextMonday(_ today: DateKey) -> Int {
        let days = (8 - Dates.weekdayOf(today)) % 7
        return days == 0 ? 7 : days
    }

    /// JavaScript's `new Date(year, month, day)` for a zero-based month that may overflow into later years, or nil
    /// when the day does not exist in that month.
    static func calendarDate(_ year: Int, _ month: Int, _ day: Int) -> DateKey? {
        guard month >= 0 else { return nil }
        let start = (0...99).contains(year) ? year + 1900 : year
        let y = start + month / 12
        let m = month % 12 + 1
        guard day >= 1, day <= Dates.daysInMonth(year: y, month: m) else { return nil }
        return Dates.key(days: Dates.days(year: y, month: m, day: day))
    }

    /// A month and day without a year means the next one, counting today.
    static func monthDay(_ today: DateKey, _ month: Int, _ day: Int, _ yearText: String?) -> DateKey? {
        if let yearText, let year = Int(yearText) {
            return calendarDate(yearText.utf16.count == 2 ? 2000 + year : year, month, day)
        }
        let year = Dates.parts(today).year
        guard let key = calendarDate(year, month, day) else { return nil }
        return key < today ? calendarDate(year + 1, month, day) : key
    }

    struct Day {
        var date: DateKey
        var time: TimeOfDay?
    }

    static let dayWords: [String: @Sendable (DateKey) -> Day] = [
        "today": { Day(date: $0, time: nil) },
        "tonight": { Day(date: $0, time: Dates.toTimeOfDay(hours: 20, minutes: 0)) },
        "tomorrow": { Day(date: Dates.addDays($0, 1), time: nil) },
        "tmr": { Day(date: Dates.addDays($0, 1), time: nil) },
        "tmrw": { Day(date: Dates.addDays($0, 1), time: nil) },
        "tom": { Day(date: Dates.addDays($0, 1), time: nil) },
        "eod": { Day(date: $0, time: Dates.toTimeOfDay(hours: 17, minutes: 0)) },
        "eow": { Day(date: nextWeekday($0, 5), time: Dates.toTimeOfDay(hours: 17, minutes: 0)) },
    ]

    static let dateReaders: [(Pattern, @Sendable (Found, DateKey) -> DateKey?)] = [
        (Pattern(#"^(?:next|nxt) week$"#), { _, today in Dates.addDays(today, daysToNextMonday(today)) }),
        (Pattern(#"^(?:next|nxt) ([a-z]+)$"#), { m, today in
            Dates.addDays(today, daysToNextMonday(today) + (weekdayIndex(m[1]!) + 6) % 7)
        }),
        (Pattern(#"^([a-z]+)$"#), { m, today in
            let day = weekdayIndex(m[1]!)
            return day == -1 ? nil : nextWeekday(today, day)
        }),
        (Pattern(#"^(?:in )?(\d+) ?([a-z]+)$"#), { m, today in
            guard let amount = number(m[1]), let unit = unitOf(m[2]!)?.recurrenceUnit else { return nil }
            return Dates.addInterval(today, amount, unit)
        }),
        (Pattern(#"^the (\d{1,2})(?:st|nd|rd|th)$"#), { m, today in
            let day = number(m[1])!
            let (year, month, _) = Dates.parts(today)
            for months in 0...12 {
                if let key = calendarDate(year, month - 1 + months, day), key >= today { return key }
            }
            return nil
        }),
        (Pattern(#"^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$"#), { m, today in
            let first = number(m[1])!
            let second = number(m[2])!
            let dayFirst = first > 12 && second <= 12
            let month = dayFirst ? second : first
            if month < 1 || month > 12 { return nil }
            return monthDay(today, month - 1, dayFirst ? first : second, m[3])
        }),
        (Pattern(#"^([a-z]+) (\d{1,2})(?:st|nd|rd|th)?(?:,? (\d{4}))?$"#), { m, today in
            monthDay(today, monthIndex(m[1]!), number(m[2])!, m[3])
        }),
        (Pattern(#"^(\d{1,2})(?:st|nd|rd|th)? ([a-z]+)(?:,? (\d{4}))?$"#), { m, today in
            monthDay(today, monthIndex(m[2]!), number(m[1])!, m[3])
        }),
    ]

    static let edges = Pattern(#"^\s+|\s+$"#)

    static func trim(_ text: String) -> String { edges.replace(text) { _ in "" } }

    static func collapse(_ text: String) -> String { trim(whitespace.replace(text) { _ in " " }) }

    static func resolveDate(_ text: String, _ today: DateKey) -> Day? {
        let t = collapse(text.lowercased())
        if let word = dayWords[t] { return word(today) }
        for (pattern, read) in dateReaders {
            if let m = pattern.first(in: t), let date = read(m, today) { return Day(date: date, time: nil) }
        }
        return nil
    }

    static let momentShape = Pattern(#"^(?:in\s+)?(\d+)\s*([a-z]*)$"#, ignoreCase: true)

    static func clock(_ date: Date, in zone: TimeZone) -> TimeOfDay {
        let local = Int((date.timeIntervalSince1970 + Double(zone.secondsFromGMT(for: date))).rounded(.down))
        let minutes = ((local / 60) % 1440 + 1440) % 1440
        return Dates.toTimeOfDay(hours: minutes / 60, minutes: minutes % 60)
    }

    static func resolveMoment(_ text: String, _ ctx: Context) -> DuePhrase? {
        guard let m = momentShape.first(in: text), let amount = number(m[1]) else { return nil }
        let unitText = m[2] ?? ""
        let unit = unitText.isEmpty ? .minute : unitOf(unitText)
        guard let unit, unit.recurrenceUnit == nil, let minutes = unit.minutes else { return nil }
        let at = ctx.now.addingTimeInterval(Double(amount) * Double(minutes) * 60)
        return DuePhrase(date: Dates.toDateKey(at, in: ctx.zone), time: clock(at, in: ctx.zone))
    }

    static func readDateTime(_ m: Found, _ ctx: Context) -> DuePhrase? {
        if let moment = m["moment"] { return resolveMoment(moment, ctx) }
        let dateText = m["date1"] ?? m["date2"]
        let timeText = m["time1"] ?? m["time2"]
        let day = dateText.flatMap { resolveDate($0, ctx.today) }
        let time = timeText.flatMap(resolveTime)
        if (dateText != nil && day == nil) || (timeText != nil && time == nil) { return nil }
        return DuePhrase(date: day?.date, time: time ?? day?.time)
    }

    static let priorityWords: [String: Priority] = ["!!!": .p1, "urgent": .p1, "!!": .p2, "important": .p2]
    static let recurrenceAdverbs: [String: RecurrenceUnit] = [
        "daily": .day,
        "weekdays": .weekday,
        "weekly": .week,
        "monthly": .month,
        "yearly": .year,
        "annually": .year,
    ]

    // MARK: Rules

    static let reminderRule = Rule(
        kind: .reminder,
        pattern: Pattern(
            #"\#(before)(?:remind(?:\s+me)?\s+(?:(?<amount>\d+)\s*(?<unit>\#(beforeUnit))\s+before|\#(dateTime))|r(?<short>\d+)(?<shortUnit>[mhdw]))\#(after)"#,
            ignoreCase: true
        ),
        repeatable: true,
        guarded: true,
        read: { m, ctx in
            if let amount = number(m["amount"] ?? m["short"]), let unitText = m["unit"] ?? m["shortUnit"] {
                guard let unit = unitOf(unitText)?.minutes else { return nil }
                let (minutes, overflow) = amount.multipliedReportingOverflow(by: unit)
                return overflow ? nil : .reminder(.before(minutes: minutes))
            }
            guard let phrase = readDateTime(m, ctx) else { return nil }
            return .reminder(.at(date: phrase.date, time: phrase.time))
        }
    )

    static let recurrenceRule = Rule(
        kind: .recurrence,
        pattern: Pattern(
            #"\#(before)(?:(?:every|each)\s+(?:(?<yearDay>\#(month)\s+\#(ordinal)|\#(ordinal)\s+\#(month))|(?<other>other)\s+(?<otherUnit>day|week|month|year)|(?<interval>\d+)\s*(?<intervalUnit>\#(dayUnit))|(?<unit>day|week|month|year)|(?<workday>weekday|workday)|(?<weekdays>\#(weekdayList)|\#(weekday)))|(?<listed>\#(weekdayList))|(?<adverb>daily|weekdays|weekly|monthly|yearly|annually))\#(after)"#,
            ignoreCase: true
        ),
        repeatable: false,
        guarded: true,
        read: { m, ctx in
            if let yearDay = m["yearDay"] {
                guard let day = resolveDate(yearDay, ctx.today) else { return nil }
                return .recurrence(RecurrencePhrase(recurrence: Recurrence(interval: 1, unit: .year), anchor: day.date))
            }
            let unitText = m["otherUnit"] ?? m["intervalUnit"] ?? m["unit"]
            let days = Dates.sortWeekdays(
                weekdayWord.matches(in: m["weekdays"] ?? m["listed"] ?? "").map { weekdayIndex($0.value.lowercased()) }
            )
            let recurrence: Recurrence?
            if m["workday"] != nil {
                recurrence = Recurrence(interval: 1, unit: .weekday)
            } else if !days.isEmpty {
                recurrence = Dates.weeklyOn(1, days)
            } else if let adverb = m["adverb"] {
                recurrence = recurrenceAdverbs[adverb.lowercased()].map { Recurrence(interval: 1, unit: $0) }
            } else if let unitText, let unit = unitOf(unitText)?.recurrenceUnit {
                guard let interval = m["other"] != nil ? 2 : number(m["interval"] ?? "1") else { return nil }
                recurrence = Recurrence(interval: interval, unit: unit)
            } else {
                recurrence = nil
            }
            guard let recurrence, recurrence.interval >= 1 else { return nil }
            let anchor: DateKey? = !days.isEmpty
                ? Dates.alignToRecurrence(ctx.today, Recurrence(interval: 1, unit: .week, days: days))
                : recurrence.unit == .weekday && !Dates.isWeekday(ctx.today) ? nextWeekday(ctx.today, 1) : nil
            return .recurrence(RecurrencePhrase(recurrence: recurrence, anchor: anchor))
        }
    )

    static let priorityRule = Rule(
        kind: .priority,
        pattern: Pattern(
            #"(?<![\w#@])p([1-4])(?!\w)|(?<!\S)(!!!?)(?!\S)|(?<![\w#@])(urgent|important)\b"#,
            ignoreCase: true
        ),
        repeatable: false,
        guarded: true,
        read: { m, _ in
            let priority = number(m[1]).flatMap(Priority.init(rawValue:))
                ?? (m[2] ?? m[3]).flatMap { priorityWords[$0.lowercased()] }
            return priority.map(Match.priority)
        }
    )

    static let dueRule = Rule(
        kind: .due,
        pattern: Pattern(#"\#(before)\#(dateTime)\#(after)"#, ignoreCase: true),
        repeatable: false,
        guarded: true,
        read: { m, ctx in readDateTime(m, ctx).map(Match.due) }
    )

    static let special = Pattern(#"[.*+?^${}()|[\]\\]"#)

    static func escapeRegExp(_ text: String) -> String { special.replace(text) { "\\" + $0.value } }

    /// `#Name` or `@Name` for a name that exists, at the start of the text or after whitespace, so `a@b.com` never
    /// matches. The name must end the word, so `@home.com` and `@homework` do not read as `@home`.
    static func namedRule(
        _ kind: TokenKind,
        _ sigil: String,
        _ items: [(id: String, name: String)],
        _ read: @escaping @Sendable (String) -> Match
    ) -> Rule? {
        if items.isEmpty { return nil }
        var order: [String] = []
        var byName: [String: String] = [:]
        for item in items {
            let name = item.name.lowercased()
            if byName.updateValue(item.id, forKey: name) == nil { order.append(name) }
        }
        let names = order.enumerated()
            .sorted { a, b in
                let (la, lb) = (a.element.utf16.count, b.element.utf16.count)
                return la != lb ? la > lb : a.offset < b.offset
            }
            .map { escapeRegExp($0.element) }
        let ids = byName
        return Rule(
            kind: kind,
            pattern: Pattern(#"(?<!\S)\#(sigil)(\#(names.joined(separator: "|")))(?![\w#@]|[./:]\w)"#, ignoreCase: true),
            repeatable: kind == .label,
            guarded: false,
            read: { m, _ in read(ids[m[1]!.lowercased()]!) }
        )
    }

    // MARK: Resolving

    /// A typed date wins, moved to the first listed weekday on or after it. A time alone lands on the date set outside
    /// the text, or else on the first future occurrence: today, or tomorrow once that time has passed. A repeat without
    /// a typed date starts on its first weekday, the date set outside the text, or today, and moves to the next
    /// occurrence when its time has passed today.
    static func resolveDue(_ phrase: DuePhrase?, _ repeat: RecurrencePhrase?, _ outside: Due?, _ ctx: Context) -> Due? {
        if let date = phrase?.date {
            return Due(date: `repeat`.map { Dates.alignToRecurrence(date, $0.recurrence) } ?? date, time: phrase?.time)
        }
        let time = phrase?.time
        let passed = { (date: DateKey) in time.map { date == ctx.today && $0 < ctx.time } ?? false }
        if let `repeat` {
            if `repeat`.anchor == nil, let outside { return Due(date: outside.date, time: time ?? outside.time) }
            let date = `repeat`.anchor ?? ctx.today
            return Due(date: passed(date) ? Dates.stepRecurrence(date, `repeat`.recurrence) : date, time: time)
        }
        guard let time else { return nil }
        if let outside { return Due(date: outside.date, time: time) }
        return Due(date: passed(ctx.today) ? Dates.addDays(ctx.today, 1) : ctx.today, time: time)
    }

    static func resolveReminder(_ draft: ReminderDraft, _ due: Due?, _ ctx: Context) -> Reminder {
        switch draft {
        case let .before(minutes): return .before(minutes: minutes)
        case let .at(date, time):
            let fallback = time.map { $0 < ctx.time } == true ? Dates.addDays(ctx.today, 1) : ctx.today
            return .at(date: date ?? due?.date ?? fallback, time: time ?? Dates.toTimeOfDay(hours: 9, minutes: 0))
        }
    }

    // MARK: Parsing

    public static func parse(_ input: String, _ options: Options, in zone: TimeZone) -> Parsed {
        let now = options.now
        let ctx = Context(now: now, zone: zone, today: Dates.toDateKey(now, in: zone), time: clock(now, in: zone))
        let disabled = Set(options.disabled.map { $0.lowercased() })
        let named = [
            namedRule(.project, "#", options.projects.map { ($0.id, $0.name) }) { .project($0) },
            namedRule(.label, "@", options.labels.map { ($0.id, $0.name) }) { .label($0) },
        ].compactMap { $0 }
        let rules = [reminderRule, recurrenceRule] + named + [priorityRule, dueRule]
        let source = NSString(string: input)
        // Every phrase a rule recognizes is masked out of both views, including kept-as-text and superseded ones, so a
        // later rule never reads part of it as something else.
        var raw = input
        var guarded = maskGuarded(input)
        let claim = { (text: String, range: NSRange) in
            NSString(string: text).replacingCharacters(in: range, with: String(repeating: "_", count: range.length))
        }

        var tokens: [Token] = []
        var matches: [Match] = []
        for rule in rules {
            var found: [(token: Token, match: Match)] = []
            var spans: [NSRange] = []
            for m in rule.pattern.matches(in: rule.guarded ? guarded : raw) {
                guard let match = rule.read(m, ctx) else { continue }
                let range = m.result.range
                let text = source.substring(with: range)
                spans.append(range)
                if !disabled.contains(text.lowercased()) {
                    found.append((Token(kind: rule.kind, start: m.start, end: m.end, text: text), match))
                }
            }
            // Attributes usually trail the title, so a single-valued attribute takes its last phrase.
            for (token, match) in rule.repeatable ? found : Array(found.suffix(1)) {
                tokens.append(token)
                matches.append(match)
            }
            for span in spans {
                raw = claim(raw, span)
                guarded = claim(guarded, span)
            }
        }
        tokens = tokens.enumerated().sorted { a, b in
            a.element.start != b.element.start ? a.element.start < b.element.start : a.offset < b.offset
        }.map(\.element)

        var duePhrase: DuePhrase?
        var repeatPhrase: RecurrencePhrase?
        var priority: Priority?
        var projectId: String?
        var labelIds: [String] = []
        var reminderDrafts: [ReminderDraft] = []
        for match in matches {
            switch match {
            case let .due(due): duePhrase = due
            case let .recurrence(recurrence): repeatPhrase = recurrence
            case let .priority(level): priority = level
            case let .project(id): projectId = id
            case let .label(id): if !labelIds.contains(id) { labelIds.append(id) }
            case let .reminder(draft): reminderDrafts.append(draft)
            }
        }

        var title = ""
        var cursor = 0
        for token in tokens {
            title += source.substring(with: NSRange(location: cursor, length: token.start - cursor)) + " "
            cursor = token.end
        }
        title = collapse(title + source.substring(from: cursor))

        let outside = options.due
        let due = resolveDue(duePhrase, repeatPhrase, outside, ctx)
        return Parsed(
            title: title,
            due: due,
            recurrence: repeatPhrase?.recurrence,
            priority: priority,
            reminders: reminderDrafts.map { resolveReminder($0, due ?? outside, ctx) },
            projectId: projectId,
            labelIds: labelIds,
            tokens: tokens
        )
    }
}
