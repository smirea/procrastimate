import Foundation

extension Notifications {
    /// iOS keeps at most 64 pending requests per app. The app keeps the soonest 60 and refills the window as they fire.
    public static let maxScheduled = 60

    public struct Pending: Hashable, Sendable {
        public var id: String
        public var title: String
        public var body: String
        public var opens: API.NotificationTarget?

        public init(id: String, title: String, body: String, opens: API.NotificationTarget?) {
            self.id = id
            self.title = title
            self.body = body
            self.opens = opens
        }
    }

    /// What to add and remove so the pending requests match the schedule. A request whose title, body, or target changed is
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
            add: schedule.filter { held[$0.tag] != Pending(id: $0.tag, title: $0.title, body: $0.body, opens: $0.opens) },
            remove: pending.map(\.id).filter { isMomentTag($0) && !wanted.contains($0) }
        )
    }

    /// Whether an identifier is a scheduled moment, `at:<epoch ms>`. Any `<prefix>:<epoch ms>` counts, so a request
    /// left from before moments were grouped, `<taskId>:<epoch ms>`, is removed instead of firing beside its group.
    public static func isMomentTag(_ id: String) -> Bool {
        guard let colon = id.lastIndex(of: ":") else { return false }
        return colon != id.startIndex && Int(id[id.index(after: colon)...]) != nil
    }
}
