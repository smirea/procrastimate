import Foundation

/// Which tasks each list shows and in what order, from `shared/views.ts`.
public enum Views {
    public struct DayGroup: Hashable, Codable, Sendable {
        public var date: DateKey
        public var tasks: [TaskItem]
    }

    public struct Today: Hashable, Codable, Sendable {
        public var overdue: [TaskItem]
        public var today: [TaskItem]
    }

    /// By due date and time (a date without a time after every timed task that day, no date last), then priority, then
    /// creation.
    static func compare(_ a: TaskItem, _ b: TaskItem) -> Bool? {
        let aDue = a.due.map { "\($0.date) \($0.time ?? "99:99")" } ?? "~"
        let bDue = b.due.map { "\($0.date) \($0.time ?? "99:99")" } ?? "~"
        if aDue != bDue { return aDue < bDue }
        if a.priority != b.priority { return a.priority < b.priority }
        if a.createdAt != b.createdAt { return a.createdAt < b.createdAt }
        return nil
    }

    static func open(_ tasks: [TaskItem]) -> [TaskItem] { tasks.filter { $0.completedAt == nil } }

    /// Inbox and projects list top-level tasks, and a subtask shows as progress on its parent. Dated views list
    /// subtasks too.
    static func topLevel(_ tasks: [TaskItem]) -> [TaskItem] { open(tasks).filter { $0.parentId == nil } }

    public static func inboxTasks(_ tasks: [TaskItem]) -> [TaskItem] {
        topLevel(tasks).filter { $0.projectId == nil }.stableSorted(by: compare)
    }

    public static func projectTasks(_ tasks: [TaskItem], _ projectId: String) -> [TaskItem] {
        topLevel(tasks).filter { $0.projectId == projectId }.stableSorted(by: compare)
    }

    public static func labelTasks(_ tasks: [TaskItem], _ labelId: String) -> [TaskItem] {
        open(tasks).filter { $0.labelIds.contains(labelId) }.stableSorted(by: compare)
    }

    public static func todayTasks(_ tasks: [TaskItem], _ today: DateKey) -> Today {
        let due = open(tasks).filter { ($0.due?.date ?? "~") <= today }.stableSorted(by: compare)
        return Today(overdue: due.filter { $0.due!.date < today }, today: due.filter { $0.due!.date == today })
    }

    public static func upcomingGroups(_ tasks: [TaskItem], _ today: DateKey) -> [DayGroup] {
        var groups: [DayGroup] = []
        for task in open(tasks).filter({ ($0.due?.date ?? "") > today }).stableSorted(by: compare) {
            let date = task.due!.date
            if groups.last?.date == date {
                groups[groups.count - 1].tasks.append(task)
            } else {
                groups.append(DayGroup(date: date, tasks: [task]))
            }
        }
        return groups
    }
}
