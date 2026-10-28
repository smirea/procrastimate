import Foundation

/// Event times resolve in `zone`.
public enum Views {
    public typealias DayGroup = API.DayGroup
    public typealias Today = API.Today
    public typealias DueList = API.DueList
    public typealias DueDays = API.DueDays
    public typealias DueFilter = API.DueFilter
    public typealias CompletedPreset = API.CompletedPreset
    public typealias CompletedRange = API.CompletedRange
    public typealias ProjectGroup = API.ProjectGroup
    public typealias ProjectCompleted = API.ProjectCompleted
    public typealias SectionBadge = API.SectionBadge

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
    /// creation. Each key is built once: a comparator building both sides' keys cost n log n key builds per sort.
    static func byDue<T>(_ items: [T], task: (T) -> TaskItem, today: DateKey?, in zone: TimeZone) -> [T] {
        items.map { (item: $0, key: sortKey(task($0), today: today, in: zone)) }
            .stableSorted { a, b in
                if a.key != b.key { return a.key < b.key }
                let (x, y) = (task(a.item), task(b.item))
                if x.priority != y.priority { return x.priority < y.priority }
                if x.createdAt != y.createdAt { return x.createdAt < y.createdAt }
                return nil
            }
            .map(\.item)
    }

    static func byDue(_ tasks: [TaskItem], today: DateKey?, in zone: TimeZone) -> [TaskItem] {
        byDue(tasks, task: { $0 }, today: today, in: zone)
    }

    static func open(_ tasks: [TaskItem]) -> [TaskItem] { Triggers.openTasks(tasks) }

    /// Inbox and projects list top-level tasks, and a subtask shows as progress on its parent. Dated views list
    /// subtasks too.
    static func topLevel(_ tasks: [TaskItem]) -> [TaskItem] { open(tasks).filter { $0.parentId == nil } }

    /// The count a header over a list shows: its open rows once there are more than 4, since a glance covers a shorter
    /// list. Pass the rows the list shows, so a subtask counts only where it has a row of its own.
    public static func pendingCount(_ open: Int) -> Int? {
        open > 4 ? open : nil
    }

    /// Inbox tasks with no day. The Inbox view lists dated tasks from every project under their day instead.
    public static func inboxTasks(_ tasks: [TaskItem], _ today: DateKey, in zone: TimeZone) -> [TaskItem] {
        byDue(topLevel(tasks).filter { $0.projectId == nil && Triggers.scheduledDue($0, today, in: zone) == nil }, today: nil, in: zone)
    }

    /// The No date view: undated inbox tasks in one list, by when they were added, with no sections.
    public static func noDateTasks(_ tasks: [TaskItem], _ today: DateKey, newestFirst: Bool, in zone: TimeZone) -> [TaskItem] {
        inboxTasks(tasks, today, in: zone).stableSorted { a, b in
            if a.createdAt != b.createdAt { return newestFirst ? a.createdAt > b.createdAt : a.createdAt < b.createdAt }
            return a.id == b.id ? nil : a.id < b.id
        }
    }

    public static func projectTasks(_ tasks: [TaskItem], _ projectId: String, in zone: TimeZone) -> [TaskItem] {
        byDue(topLevel(tasks).filter { $0.projectId == projectId }, today: nil, in: zone)
    }

    /// A project's open top-level tasks under its sections: the tasks in no section first, then every section in its
    /// order, empty ones included so each stays a place to add to.
    public static func projectGroups(
        _ tasks: [TaskItem],
        _ sections: [ProjectSection],
        _ projectId: String,
        in zone: TimeZone
    ) -> [ProjectGroup] {
        let list = projectTasks(tasks, projectId, in: zone)
        let own = StoreRules.sectionsOf(sections, projectId)
        let placed = Set(own.map(\.id))
        let loose = list.filter { task in task.sectionId.map { !placed.contains($0) } ?? true }
        return [ProjectGroup(section: nil, tasks: loose)]
            + own.map { section in ProjectGroup(section: section, tasks: list.filter { $0.sectionId == section.id }) }
    }

    public static func labelTasks(_ tasks: [TaskItem], _ labelId: String, in zone: TimeZone) -> [TaskItem] {
        byDue(open(tasks).filter { $0.labelIds.contains(labelId) }, today: nil, in: zone)
    }

    /// Every open task at a place, subtasks included, like a label view.
    public static func placeTasks(_ tasks: [TaskItem], _ key: String, in zone: TimeZone) -> [TaskItem] {
        byDue(open(tasks).filter { $0.location.map(Triggers.placeKey) == key }, today: nil, in: zone)
    }

    /// A label's view: the open tasks carrying it, or for a saved place, the open tasks at it.
    public static func labelViewTasks(_ tasks: [TaskItem], _ label: Label, in zone: TimeZone) -> [TaskItem] {
        label.place.map { placeTasks(tasks, Triggers.placeKey($0), in: zone) } ?? labelTasks(tasks, label.id, in: zone)
    }

    /// How many open tasks each project and label view lists, in one pass, for the browse counts: a project counts
    /// its top-level tasks, a label every task carrying it, and a saved place every task at it, as the views do.
    public static func openCounts(_ tasks: [TaskItem], _ labels: [Label]) -> (projects: [String: Int], labels: [String: Int]) {
        var projects: [String: Int] = [:]
        var byLabel: [String: Int] = [:]
        var byPlace: [String: Int] = [:]
        for task in open(tasks) {
            if task.parentId == nil, let projectId = task.projectId { projects[projectId, default: 0] += 1 }
            for id in task.labelIds { byLabel[id, default: 0] += 1 }
            if let location = task.location { byPlace[Triggers.placeKey(location), default: 0] += 1 }
        }
        var counts: [String: Int] = [:]
        for label in labels {
            counts[label.id] = label.place.map { byPlace[Triggers.placeKey($0)] ?? 0 } ?? byLabel[label.id] ?? 0
        }
        return (projects, counts)
    }

    /// Every open task on a calendar event, in the order their moments come.
    public static func eventTasks(_ tasks: [TaskItem], _ eventId: String, _ today: DateKey, in zone: TimeZone) -> [TaskItem] {
        byDue(open(tasks).filter { $0.event?.id == eventId }, today: today, in: zone)
    }

    /// The rows of a dated list from `from` through `to`, each with the day it sits on, which for an event or a repeat
    /// at a place is not its stored due date. A nil end is open. A subtask has a row of its own only while no task
    /// above it has one in the same list: under a listed task it shows as that task's progress, as in a project, and
    /// once none above it is listed it shows alone. The filter runs first, so a subtask whose parent the filter hides
    /// gets its own row.
    static func dated(
        _ tasks: [TaskItem], _ today: DateKey, from: DateKey?, to: DateKey?, filtered: DueFilter?, in zone: TimeZone
    ) -> [(task: TaskItem, date: DateKey)] {
        let open = open(tasks)
        var days: [String: DateKey] = [:]
        for task in filtered.map({ ListFilters.filterTasks(open, $0.filter, me: $0.me) }) ?? open {
            guard let date = Triggers.scheduledDue(task, today, in: zone)?.date else { continue }
            if from.map({ date >= $0 }) ?? true, to.map({ date <= $0 }) ?? true { days[task.id] = date }
        }
        let byID = Dictionary(open.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        return open.compactMap { task in
            guard let date = days[task.id],
                  !Triggers.ancestors(of: task, in: byID).contains(where: { days[$0.id] != nil }) else { return nil }
            return (task, date)
        }
    }

    /// A dated list's rows: overdue, today's, then each later day.
    static func byDay(
        _ tasks: [TaskItem], _ today: DateKey, from: DateKey?, to: DateKey?, filtered: DueFilter? = nil, in zone: TimeZone
    ) -> DueDays {
        let rows = byDue(dated(tasks, today, from: from, to: to, filtered: filtered, in: zone), task: \.task, today: today, in: zone)
        var days: [DayGroup] = []
        // Sorted by the day each sits on, so a group is always the last one or a new one.
        for (task, date) in rows where date > today {
            if days.last?.date == date {
                days[days.count - 1].tasks.append(task)
            } else {
                days.append(DayGroup(date: date, tasks: [task]))
            }
        }
        return DueDays(
            overdue: rows.filter { $0.date < today }.map(\.task),
            today: rows.filter { $0.date == today }.map(\.task),
            days: days
        )
    }

    /// The pill a section with `counter: .badge` shows over its open rows: the overdue and today's ones when it has any,
    /// the same rule as the Inbox badge, else every open row. An empty section shows none.
    public static func sectionBadge(_ rows: [TaskItem], _ today: DateKey, in zone: TimeZone) -> SectionBadge? {
        let due = todayTasks(rows, today, in: zone)
        let count = due.overdue.count + due.today.count
        if count > 0 { return SectionBadge(count: count, due: true) }
        return rows.isEmpty ? nil : SectionBadge(count: rows.count, due: false)
    }

    /// The overdue and today's tasks, as a list of only those days shows them.
    public static func todayTasks(_ tasks: [TaskItem], _ today: DateKey, in zone: TimeZone) -> Today {
        let due = byDay(tasks, today, from: nil, to: today, in: zone)
        return Today(overdue: due.overdue, today: due.today)
    }

    public static func upcomingGroups(_ tasks: [TaskItem], _ today: DateKey, in zone: TimeZone) -> [DayGroup] {
        byDay(tasks, today, from: Dates.addDays(today, 1), to: nil, in: zone).days
    }

    /// The last day This week lists: the coming Sunday, or today on a Sunday, since weeks start on Monday.
    public static func weekEnd(_ today: DateKey) -> DateKey {
        Dates.addDays(today, 6 - Dates.mondayIndex(Dates.weekdayOf(today)))
    }

    /// The days a dated list covers. Inbox lists every dated task, This week the overdue ones through the end of the
    /// week, and Tomorrow only tomorrow's, since overdue tasks are already today's business.
    public static func dueDays(
        _ tasks: [TaskItem], _ today: DateKey, _ list: DueList, filtered: DueFilter? = nil, in zone: TimeZone
    ) -> DueDays {
        switch list {
        case .inbox: byDay(tasks, today, from: nil, to: nil, filtered: filtered, in: zone)
        case .thisWeek: byDay(tasks, today, from: nil, to: weekEnd(today), filtered: filtered, in: zone)
        case .tomorrow:
            byDay(tasks, today, from: Dates.addDays(today, 1), to: Dates.addDays(today, 1), filtered: filtered, in: zone)
        }
    }

    /// Today, the last 7 days, or the last 30 days, each counting today, or all time.
    public static func completedRange(_ preset: CompletedPreset, _ today: DateKey) -> CompletedRange {
        switch preset {
        case .today: CompletedRange(from: today, to: today)
        case .week: CompletedRange(from: Dates.addDays(today, -6), to: today)
        case .month: CompletedRange(from: Dates.addDays(today, -29), to: today)
        case .all: CompletedRange(from: nil, to: nil)
        }
    }

    /// When the task was last completed: a done task's `completedAt`, or the last roll of a task that repeats. A
    /// repeating task keeps no history of earlier rolls, so it counts once, at its latest. A reopened task keeps
    /// `lastCompletedAt`, which is why the repeat has to be there too.
    public static func completedMoment(_ task: TaskItem) -> Int? {
        if let completedAt = task.completedAt { return completedAt }
        return task.recurrence != nil || task.event?.series == true ? task.lastCompletedAt : nil
    }

    /// Completed tasks in `range`, newest first. A subtask completed along with its parent shows as the parent's
    /// progress instead of its own row, since completing a parent completes every open subtask at the same moment.
    public static func completedTasks(_ tasks: [TaskItem], _ range: CompletedRange, in zone: TimeZone) -> [TaskItem] {
        let byID = Dictionary(tasks.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        return tasks.compactMap { task -> (task: TaskItem, at: Int)? in
            guard let at = completedMoment(task) else { return nil }
            if task.completedAt != nil, let parent = task.parentId.flatMap({ byID[$0] }), parent.completedAt == task.completedAt { return nil }
            let day = Dates.toDateKey(Date(epochMilliseconds: at), in: zone)
            if let from = range.from, day < from { return nil }
            if let to = range.to, day > to { return nil }
            return (task, at)
        }
        .stableSorted { a, b in
            if a.at != b.at { return a.at > b.at }
            return a.task.id == b.task.id ? nil : a.task.id < b.task.id
        }
        .map(\.task)
    }

    /// Completed tasks in `range` under the local day each was completed, newest day first.
    public static func completedDays(_ tasks: [TaskItem], _ range: CompletedRange, in zone: TimeZone) -> [DayGroup] {
        var groups: [DayGroup] = []
        for task in completedTasks(tasks, range, in: zone) {
            let day = Dates.toDateKey(Date(epochMilliseconds: completedMoment(task)!), in: zone)
            if groups.last?.date == day {
                groups[groups.count - 1].tasks.append(task)
            } else {
                groups.append(DayGroup(date: day, tasks: [task]))
            }
        }
        return groups
    }

    /// A project's completed tasks, all time and newest first, under the same headings as `projectGroups`, so each
    /// shows in its section below the open ones. A subtask goes with its top-level task's section. A done task whose
    /// section is not one of the project's live sections goes in `gone`, which the views show at the bottom.
    public static func projectCompleted(
        _ tasks: [TaskItem],
        _ sections: [ProjectSection],
        _ projectId: String,
        in zone: TimeZone
    ) -> ProjectCompleted {
        let byID = Dictionary(tasks.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        func sectionOf(_ task: TaskItem) -> String? {
            var root = task
            while let parent = root.parentId.flatMap({ byID[$0] }) { root = parent }
            return root.sectionId
        }
        let done = completedTasks(tasks.filter { $0.projectId == projectId }, .init(), in: zone)
            .map { (task: $0, sectionId: sectionOf($0)) }
        let own = StoreRules.sectionsOf(sections, projectId)
        let placed = Set(own.map(\.id))
        func tasksIn(_ sectionId: String?) -> [TaskItem] { done.filter { $0.sectionId == sectionId }.map(\.task) }
        return ProjectCompleted(
            groups: [ProjectGroup(section: nil, tasks: tasksIn(nil))]
                + own.map { ProjectGroup(section: $0, tasks: tasksIn($0.id)) },
            gone: done.filter { $0.sectionId.map { !placed.contains($0) } ?? false }.map(\.task)
        )
    }
}
