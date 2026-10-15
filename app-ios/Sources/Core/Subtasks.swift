import Foundation

/// The subtask rules of `shared/subtasks.ts`. Subtasks are tasks with a `parentId`, nested to any depth. Every command
/// keeps two invariants: an open task never sits under a completed one, and a subtask shares its root task's project.
/// Commands return the new versions of the tasks they change, so the caller can keep the old ones for undo.
public enum Subtasks {
    public typealias Progress = API.SubtaskProgress
    public typealias Completion = API.SubtaskCompletion

    static func siblingOrder(_ a: TaskItem, _ b: TaskItem) -> Bool? {
        if a.order != b.order { return a.order < b.order }
        if a.createdAt != b.createdAt { return a.createdAt < b.createdAt }
        if a.id != b.id { return a.id < b.id }
        return nil
    }

    /// Each parent's children in sibling order.
    public static func groupChildren(_ tasks: [TaskItem]) -> [String: [TaskItem]] {
        var groups: [String: [TaskItem]] = [:]
        for task in tasks {
            guard let parentId = task.parentId else { continue }
            groups[parentId, default: []].append(task)
        }
        return groups.mapValues { $0.stableSorted(by: siblingOrder) }
    }

    public static func descendantsOf(_ tasks: [TaskItem], _ id: String) -> [TaskItem] {
        let children = groupChildren(tasks)
        var out: [TaskItem] = []
        var queue = [id]
        while !queue.isEmpty {
            let next = queue.removeFirst()
            for child in children[next] ?? [] {
                out.append(child)
                queue.append(child.id)
            }
        }
        return out
    }

    /// From the root down to the task's parent.
    public static func ancestorsOf(_ tasks: [TaskItem], _ id: String) -> [TaskItem] {
        let byId = Dictionary(tasks.map { ($0.id, $0) }, uniquingKeysWith: { _, last in last })
        var out: [TaskItem] = []
        var parent = byId[id]?.parentId.flatMap { byId[$0] }
        while let current = parent {
            out.insert(current, at: 0)
            parent = current.parentId.flatMap { byId[$0] }
        }
        return out
    }

    /// Counts direct children, or nil for a task without any.
    public static func progressOf(_ children: [TaskItem]) -> Progress? {
        if children.isEmpty { return nil }
        return Progress(done: children.count { $0.completedAt != nil }, total: children.count)
    }

    public static func nextSiblingOrder(_ tasks: [TaskItem], _ parentId: String) -> Double {
        tasks.filter { $0.parentId == parentId }.map(\.order).reduce(-1, max) + 1
    }

    /// A task on an event series moves past the occurrence it is on, and any missed before it, to the next one the
    /// calendar listed. With none left it completes, until iOS lists more.
    static func nextEventOccurrence(_ task: TaskItem, today: DateKey, in zone: TimeZone) -> (due: Due, event: TaskEvent)? {
        guard var event = task.event, event.series else { return nil }
        let current = Triggers.currentOccurrence(event, today, in: zone)
        let index = event.occurrences.firstIndex(of: current) ?? 0
        let rest = Array(event.occurrences[(index + 1)...])
        guard let first = rest.first else { return nil }
        event.occurrences = rest
        return (Triggers.occurrenceDue(event, first, in: zone), event)
    }

    /// Completing a task completes every open subtask under it. A recurring task, or one on an event series, moves to
    /// its next occurrence instead, and every subtask under it reopens, so each occurrence starts with a fresh checklist.
    /// Either way the task's `lastCompletedAt` becomes `now`, which is what tells a roll apart from a postpone.
    public static func completeTask(
        _ tasks: [TaskItem],
        _ id: String,
        today: DateKey,
        now: Int,
        in zone: TimeZone
    ) -> Completion? {
        guard let task = tasks.first(where: { $0.id == id }) else { return nil }
        let descendants = descendantsOf(tasks, id)
        var rolled = task
        let nextDue: Due
        if let next = Dates.nextOccurrence(
            due: task.due, recurrence: task.recurrence, reminders: task.reminders, today: today
        ) {
            rolled.due = next.due
            rolled.reminders = next.reminders
            nextDue = next.due
        } else if let next = nextEventOccurrence(task, today: today, in: zone) {
            rolled.event = next.event
            nextDue = next.due
        } else {
            let changed = ([task] + descendants).filter { $0.completedAt == nil }.map { t in
                var t = t
                t.completedAt = now
                if t.id == id { t.lastCompletedAt = now }
                return t
            }
            return .done(changed: changed)
        }
        let reopened = descendants.filter { $0.completedAt != nil }.map { t in
            var t = t
            t.completedAt = nil
            return t
        }
        rolled.lastCompletedAt = now
        return .rolled(next: nextDue, changed: [rolled] + reopened)
    }

    /// Reopening a subtask reopens every completed task above it.
    public static func reopenTask(_ tasks: [TaskItem], _ id: String) -> [TaskItem] {
        guard let task = tasks.first(where: { $0.id == id }) else { return [] }
        return (ancestorsOf(tasks, id) + [task]).filter { $0.completedAt != nil }.map { t in
            var t = t
            t.completedAt = nil
            return t
        }
    }

    /// Below this gap a move renumbers its siblings instead of splitting it further.
    static let minOrderGap = 1e-9

    /// Moves a subtask to `index` among its siblings by writing only its own `order`: the midpoint of its new
    /// neighbors, or one past the only one. Below `minOrderGap` it renumbers the siblings instead.
    public static func moveSubtask(_ tasks: [TaskItem], _ id: String, _ index: Int) -> [TaskItem] {
        guard let task = tasks.first(where: { $0.id == id }), let parentId = task.parentId else { return [] }
        let siblings = groupChildren(tasks)[parentId] ?? []
        let others = siblings.filter { $0.id != id }
        let at = max(0, min(index, others.count))
        let previous = at > 0 ? others[at - 1].order : nil
        let next = at < others.count ? others[at].order : nil
        if let previous, let next, next - previous < minOrderGap {
            var placed = others
            placed.insert(task, at: at)
            return placed.enumerated().compactMap { order, t in
                guard t.order != Double(order) else { return nil }
                var t = t
                t.order = Double(order)
                return t
            }
        }
        if siblings.firstIndex(where: { $0.id == id }) == at { return [] }
        var moved = task
        switch (previous, next) {
        case (nil, nil): moved.order = 0
        case let (nil, next?): moved.order = next - 1
        case let (previous?, nil): moved.order = previous + 1
        case let (previous?, next?): moved.order = (previous + next) / 2
        }
        return [moved]
    }

    /// Makes a task whose parent is missing, or whose parents loop back to it, a top-level task, so it never goes
    /// unreachable.
    public static func detachOrphans(_ tasks: [TaskItem]) -> [TaskItem] {
        let byId = Dictionary(tasks.map { ($0.id, $0) }, uniquingKeysWith: { _, last in last })
        func reachesRoot(_ task: TaskItem) -> Bool {
            var seen: Set = [task.id]
            var id = task.parentId
            while let current = id {
                guard let parent = byId[current], !seen.contains(current) else { return false }
                seen.insert(current)
                id = parent.parentId
            }
            return true
        }
        return tasks.map { t in
            guard !reachesRoot(t) else { return t }
            var t = t
            t.parentId = nil
            return t
        }
    }
}

extension Array {
    /// Sorts by a comparison that returns nil for a tie, keeping tied elements in their order like JavaScript's sort.
    func stableSorted(by order: (Element, Element) -> Bool?) -> [Element] {
        enumerated()
            .sorted { a, b in order(a.element, b.element) ?? (a.offset < b.offset) }
            .map(\.element)
    }
}

extension API.SubtaskCompletion {
    public var changed: [TaskItem] {
        switch self {
        case let .done(changed), let .rolled(_, changed): changed
        }
    }
}
