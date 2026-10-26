import Foundation

public enum Notifications {
    public typealias Scheduled = API.ScheduledNotification

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

    /// The due day and time, such as `Today 3:00 PM` or `Tue Oct 20`, or `Reminder`. Days are named relative to the
    /// moment it shows.
    public static func notificationBody(_ due: Due?, at: Date, in zone: TimeZone) -> String {
        guard let due else { return "Reminder" }
        let today = Dates.toDateKey(at, in: zone)
        let day = Format.relativeDay(due.date, today) ?? Format.calendarDay(due.date, today)
        return due.time.map { "\(day) \(Format.clockTime($0))" } ?? day
    }

    /// Every future moment an open task notifies, soonest first, keeping the soonest `limit`. Tasks that notify at the
    /// same moment share one notification.
    public static func upcomingNotifications(
        _ tasks: [TaskItem],
        now: Date,
        limit: Int,
        in zone: TimeZone
    ) -> [Scheduled] {
        let today = Dates.toDateKey(now, in: zone)
        var moments: [Int] = []
        var firing: [Int: [TaskItem]] = [:]
        for task in tasks where task.completedAt == nil {
            for at in Triggers.taskNotificationTimes(task, today, in: zone) where at > now {
                let moment = at.epochMilliseconds
                if firing[moment] == nil { moments.append(moment) }
                firing[moment, default: []].append(task)
            }
        }
        return moments.sorted().prefix(limit).map { moment in
            momentNotification(firing[moment] ?? [], at: Date(epochMilliseconds: moment), today: today, in: zone)
        }
    }

    /// One task as itself, opening its details. Several as their count and first titles, opening the list they all
    /// share: their event, their place, their project, or else Inbox.
    public static func momentNotification(_ tasks: [TaskItem], at: Date, today: DateKey, in zone: TimeZone) -> Scheduled {
        guard let first = tasks.first else { preconditionFailure("A notification needs a task") }
        if tasks.count == 1 {
            return Scheduled(
                at: at,
                title: cut(first.title),
                body: first.event.map(Triggers.formatEvent)
                    ?? notificationBody(Triggers.scheduledDue(first, today, in: zone), at: at, in: zone),
                opens: .init(kind: .task, id: first.id)
            )
        }
        let opens = sharedList(tasks)
        let name = switch opens.kind {
        case .event: first.event.map { " for \($0.title)" } ?? ""
        case .place: first.location.map { " at \($0.name)" } ?? ""
        default: ""
        }
        return Scheduled(at: at, title: cut("\(tasks.count) tasks\(name)"), body: titleList(tasks.map(\.title)), opens: opens)
    }

    /// What a crossing at a place shows: one task as itself, several as their count and first titles, opening the
    /// place.
    public static func placeNotification(_ tasks: [TaskItem], _ location: TaskLocation, at: Date) -> Scheduled {
        if tasks.count == 1, let task = tasks.first {
            return Scheduled(at: at, title: cut(task.title), body: Triggers.formatLocation(location), opens: .init(kind: .task, id: task.id))
        }
        let edge = location.trigger == .leave ? "leaving" : "at"
        return Scheduled(
            at: at,
            title: cut("\(tasks.count) tasks \(edge) \(location.name)"),
            body: titleList(tasks.map(\.title)),
            opens: .init(kind: .place, id: Triggers.placeKey(location))
        )
    }

    private static func sharedList(_ tasks: [TaskItem]) -> API.NotificationTarget {
        func shared(_ key: (TaskItem) -> String?) -> String? {
            let keys = Set(tasks.map(key))
            guard keys.count == 1, let only = keys.first, let only, !only.isEmpty else { return nil }
            return only
        }
        if let event = shared({ $0.event?.id }) { return .init(kind: .event, id: event) }
        if let place = shared({ $0.location.map(Triggers.placeKey) }) { return .init(kind: .place, id: place) }
        if let project = shared({ $0.projectId }) { return .init(kind: .project, id: project) }
        return .init(kind: .inbox, id: "")
    }

    /// `Gym, Rent, Taxes`, or `Gym, Rent, Taxes, and 2 more` past three.
    public static func titleList(_ titles: [String]) -> String {
        let listed = titles.prefix(3).joined(separator: ", ")
        return cut(titles.count > 3 ? "\(listed), and \(titles.count - 3) more" : listed)
    }

    private static func cut(_ text: String) -> String {
        String(decoding: Array(text.utf16.prefix(300)), as: UTF16.self)
    }
}

extension API.ScheduledNotification {
    /// The identifier both clients use, `at:<epoch ms>`: one notification per moment, so scheduling it again replaces it.
    public var tag: String { "at:\(at.epochMilliseconds)" }
}
