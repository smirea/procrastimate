import Foundation

/// The iOS side of notifying: which moments the device keeps pending, and which reminders the open app shows.
extension Notifications {
    /// iOS keeps at most 64 pending requests per app. The app keeps the soonest 60 and refills the window as they fire.
    public static let maxScheduled = 60

    /// A request the device already holds, by the identifier and content it was scheduled with.
    public struct Pending: Hashable, Sendable {
        public var id: String
        public var title: String
        public var body: String

        public init(id: String, title: String, body: String) {
            self.id = id
            self.title = title
            self.body = body
        }
    }

    /// What to add and remove so the pending requests match the schedule. A request whose title or body changed is
    /// added again, which replaces it under the same identifier. Requests outside the task schedule, such as the
    /// test notification, are left alone.
    public struct ScheduleChange: Equatable, Sendable {
        public var add: [Scheduled] = []
        public var remove: [String] = []

        public init(add: [Scheduled] = [], remove: [String] = []) {
            self.add = add
            self.remove = remove
        }
    }

    public static func scheduleChange(_ schedule: [Scheduled], pending: [Pending]) -> ScheduleChange {
        let held = Dictionary(pending.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        let wanted = Set(schedule.map(\.tag))
        return ScheduleChange(
            add: schedule.filter { held[$0.tag] != Pending(id: $0.tag, title: $0.title, body: $0.body) },
            remove: pending.map(\.id).filter { isTaskTag($0) && !wanted.contains($0) }
        )
    }

    /// Whether an identifier is a task moment, `<taskId>:<epoch ms>`.
    public static func isTaskTag(_ id: String) -> Bool {
        guard let colon = id.lastIndex(of: ":") else { return false }
        return colon != id.startIndex && Int(id[id.index(after: colon)...]) != nil
    }

    /// Open tasks whose due time or a reminder came up after `since` and by `now`, like the web's `fireDueReminders`.
    public static func dueReminders(_ tasks: [TaskItem], since: Int, now: Int, in zone: TimeZone) -> [TaskItem] {
        let today = Dates.toDateKey(Date(epochMilliseconds: now), in: zone)
        return tasks.filter { task in
            task.completedAt == nil && Triggers.taskNotificationTimes(task, today, in: zone).contains {
                let at = $0.epochMilliseconds
                return at > since && at <= now
            }
        }
    }
}
