import Foundation

/// The date and recurrence rules of `shared/task.ts`. Calendar dates are civil (no zone), and only turning a date and
/// time into a moment takes a time zone, which the caller passes in.
public enum Dates {
    // MARK: Civil dates

    /// Days since 1970-01-01 for a proleptic Gregorian date, from Howard Hinnant's `days_from_civil`.
    static func days(year: Int, month: Int, day: Int) -> Int {
        let y = month <= 2 ? year - 1 : year
        let era = (y >= 0 ? y : y - 399) / 400
        let yoe = y - era * 400
        let doy = (153 * (month + (month > 2 ? -3 : 9)) + 2) / 5 + day - 1
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
        return era * 146_097 + doe - 719_468
    }

    static func civil(days: Int) -> (year: Int, month: Int, day: Int) {
        let z = days + 719_468
        let era = (z >= 0 ? z : z - 146_096) / 146_097
        let doe = z - era * 146_097
        let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
        let mp = (5 * doy + 2) / 153
        let day = doy - (153 * mp + 2) / 5 + 1
        let month = mp < 10 ? mp + 3 : mp - 9
        return (yoe + era * 400 + (month <= 2 ? 1 : 0), month, day)
    }

    static func parts(_ key: DateKey) -> (year: Int, month: Int, day: Int) {
        let numbers = key.split(separator: "-").map { Int($0) ?? 0 }
        return (numbers[0], numbers[1], numbers[2])
    }

    static func days(_ key: DateKey) -> Int {
        let (y, m, d) = parts(key)
        return days(year: y, month: m, day: d)
    }

    static func pad(_ n: Int) -> String { n < 10 ? "0\(n)" : String(n) }

    static func key(days: Int) -> DateKey {
        let (y, m, d) = civil(days: days)
        return "\(y)-\(pad(m))-\(pad(d))"
    }

    static func daysInMonth(year: Int, month: Int) -> Int {
        let total = year * 12 + month
        return days(year: total / 12, month: total % 12 + 1, day: 1) - days(year: year, month: month, day: 1)
    }

    public static func toTimeOfDay(hours: Int, minutes: Int) -> TimeOfDay { "\(pad(hours)):\(pad(minutes))" }

    public static func addDays(_ key: DateKey, _ days: Int) -> DateKey { Self.key(days: Self.days(key) + days) }

    /// Clamps to the last day of a shorter month, so Jan 31 plus one month is Feb 28.
    public static func addMonths(_ key: DateKey, _ months: Int) -> DateKey {
        let (y, m, d) = parts(key)
        let total = y * 12 + (m - 1) + months
        let year = Int((Double(total) / 12).rounded(.down))
        let month = total - year * 12 + 1
        return Self.key(days: days(year: year, month: month, day: min(d, daysInMonth(year: year, month: month))))
    }

    public static func addInterval(_ key: DateKey, _ interval: Int, _ unit: RecurrenceUnit) -> DateKey {
        switch unit {
        case .day: return addDays(key, interval)
        case .weekday:
            var date = key
            var left = interval
            while left > 0 {
                date = addDays(date, 1)
                if isWeekday(date) { left -= 1 }
            }
            return date
        case .week: return addDays(key, interval * 7)
        case .month: return addMonths(key, interval)
        case .year: return addMonths(key, interval * 12)
        }
    }

    public static func weekdayOf(_ key: DateKey) -> Weekday {
        let r = (days(key) + 4) % 7
        return r < 0 ? r + 7 : r
    }

    public static func isWeekday(_ key: DateKey) -> Bool {
        let day = weekdayOf(key)
        return day != 0 && day != 6
    }

    /// Monday is 0 and Sunday is 6, since weeks start on Monday.
    public static func mondayIndex(_ day: Weekday) -> Int { (day + 6) % 7 }

    /// Dedupes and sorts Monday first, the stored order of `days`.
    public static func sortWeekdays(_ days: some Sequence<Weekday>) -> [Weekday] {
        var seen = Set<Weekday>()
        return days.filter { seen.insert($0).inserted }.sorted { mondayIndex($0) < mondayIndex($1) }
    }

    /// A weekly repeat on `days`. One day is a plain weekly repeat, which follows the due date's weekday.
    public static func weeklyOn(_ interval: Int, _ days: some Sequence<Weekday>) -> Recurrence {
        let sorted = sortWeekdays(days)
        return Recurrence(interval: interval, unit: .week, days: sorted.count > 1 ? sorted : nil)
    }

    /// The occurrence after `date`. A weekday set moves to the next listed day of the same week, or past Sunday to the
    /// first listed day `interval` weeks after this week's Monday.
    public static func stepRecurrence(_ date: DateKey, _ recurrence: Recurrence) -> DateKey {
        guard recurrence.unit == .week, let days = recurrence.days, let first = days.first else {
            return addInterval(date, recurrence.interval, recurrence.unit)
        }
        let position = mondayIndex(weekdayOf(date))
        if let later = days.first(where: { mondayIndex($0) > position }) {
            return addDays(date, mondayIndex(later) - position)
        }
        return addDays(date, recurrence.interval * 7 - position + mondayIndex(first))
    }

    /// The first occurrence on or after `date`: `date` itself unless a weekday set leaves it out.
    public static func alignToRecurrence(_ date: DateKey, _ recurrence: Recurrence) -> DateKey {
        guard recurrence.unit == .week, let days = recurrence.days, !days.contains(weekdayOf(date)) else { return date }
        var once = recurrence
        once.interval = 1
        return stepRecurrence(date, once)
    }

    /// Where a recurring task moves when it is completed: the first occurrence after today, stepping one interval at a
    /// time from the due date, or from today when it has none. Each step counts from the last, so a month clamped to its
    /// last day carries that day forward. Absolute reminders shift by the same number of days, and relative reminders
    /// follow the due time.
    public static func nextOccurrence(
        due: Due?,
        recurrence: Recurrence?,
        reminders: [Reminder],
        today: DateKey
    ) -> (due: Due, reminders: [Reminder])? {
        guard let recurrence else { return nil }
        let from = due?.date ?? today
        var date = stepRecurrence(from, recurrence)
        while date <= today { date = stepRecurrence(date, recurrence) }
        let shift = days(date) - days(from)
        let shifted = reminders.map { reminder -> Reminder in
            if case let .at(day, time) = reminder { return .at(date: addDays(day, shift), time: time) }
            return reminder
        }
        return (Due(date: date, time: due?.time), shifted)
    }

    // MARK: Moments

    /// The moment a local date and time happen in `zone`, resolved like JavaScript's `new Date(y, m, d, h, min)`: a
    /// repeated hour takes its first occurrence, and a skipped hour moves forward by the gap.
    public static func fromDateKey(_ key: DateKey, _ time: TimeOfDay? = nil, in zone: TimeZone) -> Date {
        var seconds = Double(days(key)) * 86400
        if let time {
            let hm = time.split(separator: ":").map { Int($0) ?? 0 }
            seconds += Double(hm[0] * 3600 + hm[1] * 60)
        }
        let before = zone.secondsFromGMT(for: Date(timeIntervalSince1970: seconds - 86400))
        let after = zone.secondsFromGMT(for: Date(timeIntervalSince1970: seconds + 86400))
        let candidates = Set([before, after]).map { seconds - Double($0) }.sorted()
        for instant in candidates {
            let date = Date(timeIntervalSince1970: instant)
            if Double(zone.secondsFromGMT(for: date)) == seconds - instant { return date }
        }
        return Date(timeIntervalSince1970: seconds - Double(before))
    }

    /// The local calendar date a moment falls on in `zone`.
    public static func toDateKey(_ date: Date, in zone: TimeZone) -> DateKey {
        let local = date.timeIntervalSince1970 + Double(zone.secondsFromGMT(for: date))
        return key(days: Int((local / 86400).rounded(.down)))
    }
}

extension Date {
    /// Epoch milliseconds, the unit the store and the web use.
    public var epochMilliseconds: Int { Int((timeIntervalSince1970 * 1000).rounded()) }

    public init(epochMilliseconds: Int) {
        self.init(timeIntervalSince1970: Double(epochMilliseconds) / 1000)
    }
}

extension AppClock {
    /// Today's local date.
    public var today: DateKey { Dates.toDateKey(now, in: timeZone) }
}
