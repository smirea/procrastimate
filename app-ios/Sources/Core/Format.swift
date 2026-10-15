import Foundation

public enum Format {
    public typealias DueTone = API.DueTone
    public typealias PostponeOption = API.PostponeOption

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
        return shortDate(date, today)
    }

    /// `Oct 21`, with the year when it differs from today's.
    public static func shortDate(_ date: DateKey, _ today: DateKey) -> String {
        year(date) == year(today) ? monthDay(date) : "\(monthDay(date)), \(year(date))"
    }

    public static func formatDue(_ due: Due, _ today: DateKey) -> String {
        let date = formatDate(due.date, today)
        return due.time.map { "\(date) \(formatTime($0))" } ?? date
    }

    /// Red overdue, orange today, green through 3 days out, purple through a week, then gray.
    public static func dueTone(_ due: Due, _ today: DateKey) -> DueTone {
        if due.date < today { return .overdue }
        if due.date == today { return .today }
        if due.date <= Dates.addDays(today, 3) { return .soon }
        if due.date <= Dates.addDays(today, 7) { return .week }
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

    /// How long ago a task was added: `Today`, `Yesterday`, `3 days ago`, `2 weeks ago`, `5 months ago`, `1 year ago`.
    public static func addedAgo(_ added: DateKey, _ today: DateKey) -> String {
        let days = Dates.days(today) - Dates.days(added)
        if days <= 0 { return "Today" }
        if days == 1 { return "Yesterday" }
        let (count, unit) = days < 7 ? (days, "day") : days < 30 ? (days / 7, "week") : days < 365 ? (days / 30, "month") : (days / 365, "year")
        return "\(count) \(unit)\(count == 1 ? "" : "s") ago"
    }

    public static func formatReminder(_ reminder: Reminder, _ today: DateKey) -> String {
        switch reminder {
        case let .before(minutes): minutes == 0 ? "At due time" : "\(formatMinutes(minutes)) before"
        case let .at(date, time): "\(formatDate(date, today)) \(formatTime(time))"
        }
    }

    /// The Upcoming heading: `Oct 15 · Tomorrow · Thursday`.
    /// `Tomorrow`, `Friday` within the week, then `Tue, Oct 31`, with the year when it differs.
    public static func dayHeading(_ date: DateKey, _ today: DateKey) -> String {
        if date == Dates.addDays(today, 1) { return "Tomorrow" }
        if date > today, date < Dates.addDays(today, 7) { return longWeekdayNames[Dates.weekdayOf(date)] }
        return "\(weekdayNames[Dates.weekdayOf(date)]), \(shortDate(date, today))"
    }

    /// The undo toast after completing a task: `Completed “Standup”`, or `…, next due Friday 9am` when it repeats.
    public static func completedToast(_ title: String, _ next: Due?, _ today: DateKey) -> String {
        next.map { "Completed “\(title)”, next due \(formatDue($0, today))" } ?? "Completed “\(title)”"
    }

    public static func reminderToast(_ title: String) -> String { "Reminder: \(title)" }

    public static func reopenedToast(_ title: String) -> String { "Reopened “\(title)”" }

    /// When a task was completed, in `zone`: `Today 3:04pm`, `Yesterday 9am`, `Oct 12 3:04pm`.
    public static func completedWhen(_ at: Date, _ today: DateKey, in zone: TimeZone) -> String {
        let local = Int((at.timeIntervalSince1970 + Double(zone.secondsFromGMT(for: at))).rounded(.down))
        let minutes = ((local / 60) % 1440 + 1440) % 1440
        let time = Dates.toTimeOfDay(hours: minutes / 60, minutes: minutes % 60)
        return formatDue(Due(date: Dates.toDateKey(at, in: zone), time: time), today)
    }

    /// A day heading in the Completed view: `Today`, `Yesterday`, then `Mon, Oct 12`, with the year when it differs.
    public static func completedHeading(_ date: DateKey, _ today: DateKey) -> String {
        if date == today { return "Today" }
        if date == Dates.addDays(today, -1) { return "Yesterday" }
        return "\(weekdayNames[Dates.weekdayOf(date)]), \(shortDate(date, today))"
    }

    /// Today for an overdue or undated task, tomorrow, the coming Saturday, and the coming Monday, without the day the
    /// task is on or a day an earlier option names.
    public static func postponeOptions(_ due: Due?, _ today: DateKey) -> [PostponeOption] {
        let weekday = Dates.weekdayOf(today)
        let weekend = weekday == 0 || weekday == 6
        let after = { (target: Int) in Dates.addDays(today, (target - weekday + 7) % 7 == 0 ? 7 : (target - weekday + 7) % 7) }
        var options: [PostponeOption] = []
        if due == nil || due!.date < today { options.append(PostponeOption(label: "Today", date: today)) }
        options.append(PostponeOption(label: "Tomorrow", date: Dates.addDays(today, 1)))
        options.append(PostponeOption(label: weekend ? "Next weekend" : "This weekend", date: after(6)))
        options.append(PostponeOption(label: "Next week", date: after(1)))
        var seen = Set<DateKey>()
        return options.filter { $0.date != due?.date && seen.insert($0.date).inserted }
    }
}
