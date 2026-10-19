import Foundation

public typealias ListFilter = API.ListFilter
public typealias FilterGroup = API.FilterGroup
public typealias FilterOptions = API.FilterOptions

extension API.ListFilter {
    public static let none = ListFilter()

    public var active: Bool { people != nil || priorities != nil }
}

extension API.FilterOptions {
    public var isEmpty: Bool { people.isEmpty && priorities.isEmpty }
}

/// Ports `shared/list-filters.ts`: a list's filter by who made a task and by its priority.
public enum ListFilters {
    /// A task's `createdBy` is nil before the server stamps it and on imports, both made by the user.
    public static func creatorOf(_ task: TaskItem, me: String) -> String { task.createdBy ?? me }

    private static func keeps(_ filter: ListFilter, _ task: TaskItem, me: String, skip: FilterGroup? = nil) -> Bool {
        (skip == .people || filter.people.map { $0.contains(creatorOf(task, me: me)) } ?? true)
            && (skip == .priorities || filter.priorities.map { $0.contains(task.priority) } ?? true)
    }

    public static func filterTasks(_ tasks: [TaskItem], _ filter: ListFilter, me: String) -> [TaskItem] {
        filter.active ? tasks.filter { keeps(filter, $0, me: me) } : tasks
    }

    /// The choices a list's filter menu shows, counted over `tasks` (the list's open rows) as the other group filters
    /// them. A choice shows while it counts a task or is picked. People come only when someone else made one of the
    /// tasks, the user first, then by count; a group with a single choice to offer is left out, since it could not
    /// narrow the list.
    public static func filterOptions(_ tasks: [TaskItem], _ filter: ListFilter, me: String) -> FilterOptions {
        func count<T: Equatable, Option>(
            _ group: FilterGroup, _ values: [T], _ picked: [T]?, _ of: (TaskItem) -> T,
            _ make: (T, Int, Bool) -> Option
        ) -> [Option] {
            let shown = tasks.filter { keeps(filter, $0, me: me, skip: group) }
            let options = values
                .map { value in (value, shown.count { of($0) == value }, picked?.contains(value) ?? false) }
                .filter { $0.1 > 0 || $0.2 }
            return options.count > 1 || picked != nil ? options.map(make) : []
        }
        var creators = [me]
        for id in tasks.map({ creatorOf($0, me: me) }) + (filter.people ?? []) where !creators.contains(id) {
            creators.append(id)
        }
        let byCount = { (id: String) in tasks.count { creatorOf($0, me: me) == id } }
        let people = [me] + creators.dropFirst().sorted { byCount($0) != byCount($1) ? byCount($0) > byCount($1) : $0 < $1 }
        return FilterOptions(
            people: count(.people, people, filter.people, { creatorOf($0, me: me) }, API.PersonOption.init),
            priorities: count(.priorities, Priority.allCases, filter.priorities, \.priority, API.PriorityOption.init)
        )
    }

    /// Turning a group on picks every choice it offers, so the user narrows it from all; turning it off shows everything.
    public static func toggleGroup(_ filter: ListFilter, _ group: FilterGroup, _ options: FilterOptions) -> ListFilter {
        var next = filter
        switch group {
        case .people: next.people = filter.people == nil ? options.people.map(\.value) : nil
        case .priorities: next.priorities = filter.priorities == nil ? options.priorities.map(\.value) : nil
        }
        return next
    }

    /// With the group off, picking a choice shows only it.
    public static func toggleOption(_ filter: ListFilter, person: String) -> ListFilter {
        var next = filter
        next.people = toggled(filter.people, person)
        return next
    }

    public static func toggleOption(_ filter: ListFilter, priority: Priority) -> ListFilter {
        var next = filter
        next.priorities = toggled(filter.priorities, priority)
        return next
    }

    private static func toggled<T: Equatable>(_ picked: [T]?, _ value: T) -> [T]? {
        let current = picked ?? []
        let next = current.contains(value) ? current.filter { $0 != value } : current + [value]
        return next.isEmpty ? nil : next
    }

    /// Each list keeps its own filter, on this device. Inbox's day headings share Inbox's.
    public static func filterKey(_ screen: ListScreen) -> String {
        switch screen {
        case .inbox: "inbox"
        case .tomorrow: "tomorrow"
        case .thisWeek: "this-week"
        case .noDate: "no-date"
        case .completed: "completed"
        case let .project(id, _): "project:\(id)"
        case let .label(id): "label:\(id)"
        case let .place(key): "place:\(key)"
        case let .event(id): "event:\(id)"
        }
    }
}
