import Foundation

/// When tasks notify and what the notification says, from `shared/task.ts` and `shared/notifications.ts`.
public enum Notifications {
    /// One system notification, shown at `at`.
    public struct Scheduled: Hashable, Sendable {
        public var at: Date
        public var taskId: String
        public var title: String
        public var body: String

        /// The identifier both clients use, `<taskId>:<epoch ms>`, so scheduling a moment again replaces it.
        public var tag: String { "\(taskId):\(at.epochMilliseconds)" }
    }

    /// When a reminder fires, or nil for a relative reminder on a task without a due time.
    public static func reminderFiresAt(_ reminder: Reminder, _ due: Due?, in zone: TimeZone) -> Date? {
        switch reminder {
        case let .at(date, time):
            return Dates.fromDateKey(date, time, in: zone)
        case let .before(minutes):
            guard let due, let time = due.time else { return nil }
            return Dates.fromDateKey(due.date, time, in: zone).addingTimeInterval(-Double(minutes) * 60)
        }
    }

    /// When a task notifies, in order: at its due time when it has one, and at every reminder, each moment once.
    public static func notificationTimes(_ due: Due?, _ reminders: [Reminder], in zone: TimeZone) -> [Date] {
        let dueAt = due.flatMap { due in due.time.map { Dates.fromDateKey(due.date, $0, in: zone) } }
        var seen = Set<Int>()
        return ([dueAt] + reminders.map { reminderFiresAt($0, due, in: zone) })
            .compactMap { $0 }
            .filter { seen.insert($0.epochMilliseconds).inserted }
            .sorted()
    }

    /// `Due now`, `Due at 5:00 PM`, `Due Tomorrow at 5:00 PM`, `Due today`, or `Reminder`. Days are named relative to the
    /// moment it shows.
    public static func notificationBody(_ due: Due?, at: Date, in zone: TimeZone) -> String {
        guard let due else { return "Reminder" }
        let day = Dates.toDateKey(at, in: zone)
        guard let time = due.time else {
            return "Due \(Format.relativeDay(due.date, day)?.lowercased() ?? Format.calendarDay(due.date, day))"
        }
        if Dates.fromDateKey(due.date, time, in: zone).epochMilliseconds == at.epochMilliseconds { return "Due now" }
        let clock = Format.clockTime(time)
        return due.date == day
            ? "Due at \(clock)"
            : "Due \(Format.relativeDay(due.date, day) ?? Format.calendarDay(due.date, day)) at \(clock)"
    }

    /// Every future moment an open task notifies, soonest first, keeping the soonest `limit`.
    public static func upcomingNotifications(
        _ tasks: [TaskItem],
        now: Date,
        limit: Int,
        in zone: TimeZone
    ) -> [Scheduled] {
        let all = tasks.filter { $0.completedAt == nil }.flatMap { task in
            notificationTimes(task.due, task.reminders, in: zone).filter { $0 > now }.map { at in
                Scheduled(
                    at: at,
                    taskId: task.id,
                    title: String(decoding: Array(task.title.utf16.prefix(300)), as: UTF16.self),
                    body: notificationBody(task.due, at: at, in: zone)
                )
            }
        }
        return Array(all.stableSorted { a, b in a.at == b.at ? nil : a.at < b.at }.prefix(limit))
    }
}
