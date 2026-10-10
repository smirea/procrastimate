import Foundation

/// Chip, row, heading, and toast strings from `shared/format.ts`, in US English like the web.
public enum Format {
    public enum DueTone: String, Codable, Sendable {
        case overdue, today, tomorrow, week, later
    }

    public static let weekdayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    static let longWeekdayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
    static let monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

    static func hoursMinutes(_ time: TimeOfDay) -> (Int, Int) {
        let parts = time.split(separator: ":").map { Int($0) ?? 0 }
        return (parts[0], parts[1])
    }

    static func year(_ date: DateKey) -> Substring { date.prefix(4) }

    /// `Oct 21`.
    static func monthDay(_ date: DateKey) -> String {
        let (_, m, d) = Dates.parts(date)
        return "\(monthNames[m - 1]) \(d)"
    }

    public static func priorityLabel(_ priority: Priority) -> String { "Priority \(priority.rawValue)" }

    /// `5pm`, `9:05am`.
    public static func formatTime(_ time: TimeOfDay) -> String {
        let (h, m) = hoursMinutes(time)
        let suffix = h < 12 ? "am" : "pm"
        let hour = h % 12 == 0 ? 12 : h % 12
        return m == 0 ? "\(hour)\(suffix)" : "\(hour):\(Dates.pad(m))\(suffix)"
    }

    /// `Today`, `Tomorrow`, `Yesterday`, a weekday within the week ahead, else `Oct 21`, with the year when it differs.
    public static func formatDate(_ date: DateKey, _ today: DateKey) -> String {
        if date == today { return "Today" }
        if date == Dates.addDays(today, 1) { return "Tomorrow" }
        if date == Dates.addDays(today, -1) { return "Yesterday" }
        if date > today, date < Dates.addDays(today, 7) { return longWeekdayNames[Dates.weekdayOf(date)] }
        return year(date) == year(today) ? monthDay(date) : "\(monthDay(date)), \(year(date))"
    }

    public static func formatDue(_ due: Due, _ today: DateKey) -> String {
        let date = formatDate(due.date, today)
        return due.time.map { "\(date) \(formatTime($0))" } ?? date
    }

    public static func dueTone(_ due: Due, _ today: DateKey) -> DueTone {
        if due.date < today { return .overdue }
        if due.date == today { return .today }
        if due.date == Dates.addDays(today, 1) { return .tomorrow }
        if due.date < Dates.addDays(today, 7) { return .week }
        return .later
    }

    public static func formatMinutes(_ minutes: Int) -> String {
        if minutes % 1440 == 0 { return "\(minutes / 1440)d" }
        if minutes % 60 == 0 { return "\(minutes / 60)h" }
        return "\(minutes)m"
    }

    /// `Every Mon`, `Every Mon, Wed, Fri`, `Every 2 weeks on Tue, Thu`, `Every 3 days`.
    public static func formatRecurrence(_ recurrence: Recurrence, _ due: Due?) -> String {
        let interval = recurrence.interval
        let unit = recurrence.unit
        let days: [Weekday]? = unit == .week
            ? (recurrence.days ?? (due != nil && interval == 1 ? [Dates.weekdayOf(due!.date)] : nil))
            : nil
        if let days {
            let names = days.map { weekdayNames[$0] }.joined(separator: ", ")
            return interval == 1 ? "Every \(names)" : "Every \(interval) weeks on \(names)"
        }
        return interval == 1 ? "Every \(unit.rawValue)" : "Every \(interval) \(unit.rawValue)s"
    }

    /// `Repeats every Mon`.
    public static func repeatLabel(_ recurrence: Recurrence, _ due: Due?) -> String {
        let text = formatRecurrence(recurrence, due)
        return "Repeats \(text.prefix(1).lowercased())\(text.dropFirst())"
    }

    /// `5:00 PM`.
    public static func clockTime(_ time: TimeOfDay) -> String {
        let (h, m) = hoursMinutes(time)
        return "\(h % 12 == 0 ? 12 : h % 12):\(Dates.pad(m)) \(h < 12 ? "AM" : "PM")"
    }

    /// `Sat Oct 17`, with the year only when it is not this year.
    public static func calendarDay(_ date: DateKey, _ today: DateKey) -> String {
        let day = "\(weekdayNames[Dates.weekdayOf(date)]) \(monthDay(date))"
        return year(date) == year(today) ? day : "\(day), \(year(date))"
    }

    public static func relativeDay(_ date: DateKey, _ today: DateKey) -> String? {
        if date == today { return "Today" }
        if date == Dates.addDays(today, 1) { return "Tomorrow" }
        return date == Dates.addDays(today, -1) ? "Yesterday" : nil
    }

    public static func formatReminder(_ reminder: Reminder, _ today: DateKey) -> String {
        switch reminder {
        case let .before(minutes): minutes == 0 ? "At due time" : "\(formatMinutes(minutes)) before"
        case let .at(date, time): "\(formatDate(date, today)) \(formatTime(time))"
        }
    }

    /// The Upcoming heading: `Oct 15 · Tomorrow · Thursday`.
    public static func dayHeading(_ date: DateKey, _ today: DateKey) -> String {
        let weekday = longWeekdayNames[Dates.weekdayOf(date)]
        return date == Dates.addDays(today, 1)
            ? "\(monthDay(date)) · Tomorrow · \(weekday)"
            : "\(monthDay(date)) · \(weekday)"
    }

    /// The undo toast after completing a task: `Completed “Standup”`, or `…, next due Friday 9am` when it repeats.
    public static func completedToast(_ title: String, _ next: Due?, _ today: DateKey) -> String {
        next.map { "Completed “\(title)”, next due \(formatDue($0, today))" } ?? "Completed “\(title)”"
    }

    /// The toast an open app shows when a task's due time or reminder comes up.
    public static func reminderToast(_ title: String) -> String { "Reminder: \(title)" }
}
