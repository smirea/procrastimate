import Foundation

/// Event times resolve in `zone`.
public enum Views {
    public typealias DayGroup = API.DayGroup
    public typealias Today = API.Today

    /// An event task sorts by the occurrence it is on, or by its first one where a list has no today.
    static func sortKey(_ task: TaskItem, today: DateKey?, in zone: TimeZone) -> String {
        let due: Due? = if let today {
            Triggers.scheduledDue(task, today, in: zone)
        } else if let event = task.event {
            Triggers.occurrenceDue(event, event.occurrences[0], in: zone)
        } else {
            task.due
        }
        return due.map { "\($0.date) \($0.time ?? "99:99")" } ?? "~"
    }

    /// By due date and time (a date without a time after every timed task that day, no date last), then priority, then
    /// creation.
    static func compare(today: DateKey?, in zone: TimeZone) -> (TaskItem, TaskItem) -> Bool? {
        { a, b in
            let aDue = sortKey(a, today: today, in: zone)
            let bDue = sortKey(b, today: today, in: zone)
            if aDue != bDue { return aDue < bDue }
            if a.priority != b.priority { return a.priority < b.priority }
            if a.createdAt != b.createdAt { return a.createdAt < b.createdAt }
            return nil
        }
    }

    static func open(_ tasks: [TaskItem]) -> [TaskItem] { tasks.filter { $0.completedAt == nil } }

    /// Inbox and projects list top-level tasks, and a subtask shows as progress on its parent. Dated views list
    /// subtasks too.
    static func topLevel(_ tasks: [TaskItem]) -> [TaskItem] { open(tasks).filter { $0.parentId == nil } }

    /// Inbox tasks with no day. The Inbox view lists dated tasks from every project under their day instead.
    public static func inboxTasks(_ tasks: [TaskItem], _ today: DateKey, in zone: TimeZone) -> [TaskItem] {
        topLevel(tasks).filter { $0.projectId == nil && Triggers.scheduledDue($0, today, in: zone) == nil }
            .stableSorted(by: compare(today: nil, in: zone))
    }

    public static func projectTasks(_ tasks: [TaskItem], _ projectId: String, in zone: TimeZone) -> [TaskItem] {
        topLevel(tasks).filter { $0.projectId == projectId }.stableSorted(by: compare(today: nil, in: zone))
    }

    public static func labelTasks(_ tasks: [TaskItem], _ labelId: String, in zone: TimeZone) -> [TaskItem] {
        open(tasks).filter { $0.labelIds.contains(labelId) }.stableSorted(by: compare(today: nil, in: zone))
    }

    /// Every open task at a place, subtasks included, like a label view.
    public static func placeTasks(_ tasks: [TaskItem], _ key: String, in zone: TimeZone) -> [TaskItem] {
        open(tasks).filter { $0.location.map(Triggers.placeKey) == key }.stableSorted(by: compare(today: nil, in: zone))
    }

    /// Every open task on a calendar event, in the order their moments come.
    public static func eventTasks(_ tasks: [TaskItem], _ eventId: String, _ today: DateKey, in zone: TimeZone) -> [TaskItem] {
        open(tasks).filter { $0.event?.id == eventId }.stableSorted(by: compare(today: today, in: zone))
    }

    /// Dated tasks with the day each sits on, which for an event or a repeat at a place is not its stored due date.
    static func dated(_ tasks: [TaskItem], _ today: DateKey, in zone: TimeZone) -> [(task: TaskItem, date: DateKey)] {
        open(tasks).compactMap { task in Triggers.scheduledDue(task, today, in: zone).map { (task, $0.date) } }
    }

    public static func todayTasks(_ tasks: [TaskItem], _ today: DateKey, in zone: TimeZone) -> Today {
        let order = compare(today: today, in: zone)
        let due = dated(tasks, today, in: zone).filter { $0.date <= today }.stableSorted { order($0.task, $1.task) }
        return Today(
            overdue: due.filter { $0.date < today }.map(\.task),
            today: due.filter { $0.date == today }.map(\.task)
        )
    }

    public static func upcomingGroups(_ tasks: [TaskItem], _ today: DateKey, in zone: TimeZone) -> [DayGroup] {
        let order = compare(today: today, in: zone)
        var groups: [DayGroup] = []
        for (task, date) in dated(tasks, today, in: zone).filter({ $0.date > today }).stableSorted(by: { order($0.task, $1.task) }) {
            if let i = groups.firstIndex(where: { $0.date == date }) {
                groups[i].tasks.append(task)
            } else {
                groups.append(DayGroup(date: date, tasks: [task]))
            }
        }
        return groups.stableSorted { a, b in a.date == b.date ? nil : a.date < b.date }
    }
}
