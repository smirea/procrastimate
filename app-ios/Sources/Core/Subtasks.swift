import Foundation

/// The subtask rules of `shared/subtasks.ts`. Subtasks are tasks with a `parentId`, nested to any depth. Every command
/// keeps two invariants: an open task never sits under a completed one, and a subtask shares its root task's project.
/// Commands return the new versions of the tasks they change, so the caller can keep the old ones for undo.
public enum Subtasks {
    public typealias Progress = API.SubtaskProgress
    public typealias Completion = API.SubtaskCompletion

    /// Each parent's children in sibling order.
    public static func groupChildren(_ tasks: [TaskItem]) -> [String: [TaskItem]] {
        var groups: [String: [TaskItem]] = [:]
        for task in tasks {
            guard let parentId = task.parentId else { continue }
            groups[parentId, default: []].append(task)
        }
        return groups.mapValues(Order.sorted)
    }

    /// Pass `children` from `groupChildren` when walking several roots of one list, so the index is built once.
    public static func descendantsOf(
        _ tasks: [TaskItem],
        _ id: String,
        children: [String: [TaskItem]]? = nil
    ) -> [TaskItem] {
        let children = children ?? groupChildren(tasks)
        var out: [TaskItem] = []
        var queue = [id]
        var i = 0
        while i < queue.count {
            for child in children[queue[i]] ?? [] {
                out.append(child)
                queue.append(child.id)
            }
            i += 1
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

    /// Moves a subtask to `index` among its siblings by writing only its own `order`, or renumbering them all below
    /// `Order.minGap`. Returns the tasks whose order changed.
    public static func moveSubtask(_ tasks: [TaskItem], _ id: String, _ index: Int) -> [TaskItem] {
        guard let parentId = tasks.first(where: { $0.id == id })?.parentId else { return [] }
        let siblings = groupChildren(tasks)[parentId] ?? []
        return Order.moved(siblings, Order.moveOrders(siblings, id, index))
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
