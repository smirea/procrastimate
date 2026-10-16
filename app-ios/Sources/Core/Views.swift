import Foundation

/// Event times resolve in `zone`.
public enum Views {
    public typealias DayGroup = API.DayGroup
    public typealias Today = API.Today
    public typealias NoDate = API.NoDate
    public typealias PlaceSection = API.PlaceSection
    public typealias CompletedPreset = API.CompletedPreset
    public typealias CompletedRange = API.CompletedRange
    public typealias ProjectGroup = API.ProjectGroup

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

    /// Undated inbox tasks, with each place that has two or more of them in its own section below the rest, named after
    /// its earliest task's place and sorted by name. Tasks sort by when they were added.
    public static func noDateTasks(_ tasks: [TaskItem], _ today: DateKey, newestFirst: Bool, in zone: TimeZone) -> NoDate {
        let list = inboxTasks(tasks, today, in: zone).stableSorted { a, b in
            if a.createdAt != b.createdAt { return newestFirst ? a.createdAt > b.createdAt : a.createdAt < b.createdAt }
            return a.id == b.id ? nil : a.id < b.id
        }
        var order: [String] = []
        var byPlace: [String: [TaskItem]] = [:]
        for task in list {
            guard let location = task.location else { continue }
            let key = Triggers.placeKey(location)
            if byPlace[key] == nil { order.append(key) }
            byPlace[key, default: []].append(task)
        }
        let places = order.compactMap { key -> PlaceSection? in
            guard let group = byPlace[key], group.count > 1 else { return nil }
            let earliest = group.stableSorted { a, b in a.createdAt == b.createdAt ? nil : a.createdAt < b.createdAt }[0]
            return PlaceSection(key: key, name: earliest.location!.name, tasks: group)
        }.stableSorted { a, b in
            let order = a.name.compare(b.name, locale: Locale(identifier: "en"))
            if order != .orderedSame { return order == .orderedAscending }
            return a.key == b.key ? nil : a.key < b.key
        }
        let grouped = Set(places.map(\.key))
        return NoDate(loose: list.filter { $0.location.map { !grouped.contains(Triggers.placeKey($0)) } ?? true }, places: places)
    }

    public static func projectTasks(_ tasks: [TaskItem], _ projectId: String, in zone: TimeZone) -> [TaskItem] {
        topLevel(tasks).filter { $0.projectId == projectId }.stableSorted(by: compare(today: nil, in: zone))
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
            if let i = groups.firstIndex(where: { $0.date == day }) {
                groups[i].tasks.append(task)
            } else {
                groups.append(DayGroup(date: day, tasks: [task]))
            }
        }
        return groups
    }
}
