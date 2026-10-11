import Foundation

/// The subtask rules of `shared/subtasks.ts`. Subtasks are tasks with a `parentId`, nested to any depth. Every command
/// keeps two invariants: an open task never sits under a completed one, and a subtask shares its root task's project.
/// Commands return the new versions of the tasks they change, so the caller can keep the old ones for undo.
public enum Subtasks {
    public struct Progress: Hashable, Codable, Sendable {
        public var done: Int
        public var total: Int
    }

    public enum Completion: Hashable, Sendable {
        case done(changed: [TaskItem])
        case rolled(next: Due, changed: [TaskItem])

        public var changed: [TaskItem] {
            switch self {
            case let .done(changed), let .rolled(_, changed): changed
            }
        }
    }

    static func siblingOrder(_ a: TaskItem, _ b: TaskItem) -> Bool? {
        if a.order != b.order { return a.order < b.order }
        if a.createdAt != b.createdAt { return a.createdAt < b.createdAt }
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

    /// Completing a task completes every open subtask under it. A recurring task moves to its next occurrence instead,
    /// and every subtask under it reopens, so each occurrence starts with a fresh checklist.
    public static func completeTask(_ tasks: [TaskItem], _ id: String, today: DateKey, now: Int) -> Completion? {
        guard let task = tasks.first(where: { $0.id == id }) else { return nil }
        let descendants = descendantsOf(tasks, id)
        guard let next = Dates.nextOccurrence(
            due: task.due, recurrence: task.recurrence, reminders: task.reminders, today: today
        ) else {
            let changed = ([task] + descendants).filter { $0.completedAt == nil }.map { t in
                var t = t
                t.completedAt = now
                return t
            }
            return .done(changed: changed)
        }
        var rolled = task
        rolled.due = next.due
        rolled.reminders = next.reminders
        let reopened = descendants.filter { $0.completedAt != nil }.map { t in
            var t = t
            t.completedAt = nil
            return t
        }
        return .rolled(next: next.due, changed: [rolled] + reopened)
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

    /// Moves a subtask to `index` among its siblings and renumbers them.
    public static func moveSubtask(_ tasks: [TaskItem], _ id: String, _ index: Int) -> [TaskItem] {
        guard let task = tasks.first(where: { $0.id == id }), let parentId = task.parentId else { return [] }
        var siblings = (groupChildren(tasks)[parentId] ?? []).filter { $0.id != id }
        siblings.insert(task, at: max(0, min(index, siblings.count)))
        return siblings.enumerated().compactMap { order, t in
            guard t.order != Double(order) else { return nil }
            var t = t
            t.order = Double(order)
            return t
        }
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
