import Foundation

/// Everything the store holds that syncs: tasks, projects, and labels.
public struct StoreData: Hashable, Codable, Sendable {
    public var tasks: [TaskItem]
    public var projects: [Project]
    public var labels: [Label]

    public init(tasks: [TaskItem] = [], projects: [Project] = [], labels: [Label] = []) {
        self.tasks = tasks
        self.projects = projects
        self.labels = labels
    }
}

/// What the caller supplies for a new record, so the rules stay deterministic.
public struct Creation: Sendable {
    public var id: String
    /// Epoch milliseconds.
    public var now: Int

    public init(id: String, now: Int) {
        self.id = id
        self.now = now
    }
}

public struct NewTask: Hashable, Codable, Sendable {
    public var title: String
    public var projectId: String?
    public var labelIds: [String]
    public var due: Due?
    public var recurrence: Recurrence?
    public var priority: Priority?
    public var reminders: [Reminder]

    public init(
        title: String,
        projectId: String? = nil,
        labelIds: [String] = [],
        due: Due? = nil,
        recurrence: Recurrence? = nil,
        priority: Priority? = nil,
        reminders: [Reminder] = []
    ) {
        self.title = title
        self.projectId = projectId
        self.labelIds = labelIds
        self.due = due
        self.recurrence = recurrence
        self.priority = priority
        self.reminders = reminders
    }
}

/// The editable fields of a task. A nil field is left alone; for nullable fields, `.some(nil)` clears the value.
public struct TaskPatch: Hashable, Sendable {
    public var title: String?
    public var notes: String?
    public var projectId: String??
    public var labelIds: [String]?
    public var due: Due??
    public var recurrence: Recurrence??
    public var priority: Priority?
    public var reminders: [Reminder]?

    public init(
        title: String? = nil,
        notes: String? = nil,
        projectId: String?? = nil,
        labelIds: [String]? = nil,
        due: Due?? = nil,
        recurrence: Recurrence?? = nil,
        priority: Priority? = nil,
        reminders: [Reminder]? = nil
    ) {
        self.title = title
        self.notes = notes
        self.projectId = projectId
        self.labelIds = labelIds
        self.due = due
        self.recurrence = recurrence
        self.priority = priority
        self.reminders = reminders
    }

    func apply(to task: inout TaskItem) {
        if let title { task.title = title }
        if let notes { task.notes = notes }
        if let projectId { task.projectId = projectId }
        if let labelIds { task.labelIds = labelIds }
        if let due { task.due = due }
        if let recurrence { task.recurrence = recurrence }
        if let priority { task.priority = priority }
        if let reminders { task.reminders = reminders }
    }
}

/// The fields a completion changes. Undo writes back only these, so edits made since then survive it.
public struct CompletionState: Hashable, Codable, Sendable {
    public var id: String
    public var completedAt: Int?
    public var due: Due?
    public var reminders: [Reminder]

    private enum CodingKeys: String, CodingKey { case id, completedAt, due, reminders }

    public init(id: String, completedAt: Int?, due: Due?, reminders: [Reminder]) {
        self.id = id
        self.completedAt = completedAt
        self.due = due
        self.reminders = reminders
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(completedAt, forKey: .completedAt)
        try c.encode(due, forKey: .due)
        try c.encode(reminders, forKey: .reminders)
    }
}

/// `previous` holds every task the completion changed, as it was, so undo can put them back.
public struct Completion: Hashable, Sendable {
    /// The next due date of a repeating task, or nil when the task is done.
    public var next: Due?
    public var previous: [CompletionState]
}

/// The store's commands from `shared/store.ts`, as pure functions over its data, so the Swift store and the web store
/// apply the same rules.
public enum StoreRules {
    /// Tasks stay sorted by `createdAt`, then `id`, so every client and the sync server agree on one order.
    public static func sortTasks(_ tasks: [TaskItem]) -> [TaskItem] {
        tasks.stableSorted { a, b in
            if a.createdAt != b.createdAt { return a.createdAt < b.createdAt }
            if a.id != b.id { return a.id.utf16.lexicographicallyPrecedes(b.id.utf16) }
            return nil
        }
    }

    /// Writes each changed task over the task with its id.
    static func put(_ tasks: [TaskItem], _ changed: [TaskItem]) -> [TaskItem] {
        let byId = Dictionary(changed.map { ($0.id, $0) }, uniquingKeysWith: { _, last in last })
        return tasks.map { byId[$0.id] ?? $0 }
    }

    /// With a `parentId`, adds the task as that parent's last subtask, in its project, and reopens the parent if it is
    /// done. Adding rows in their source order with each row's parent reproduces an outline's nesting and order.
    /// `createdAt` is at least one past the newest task's, so tasks added within one millisecond, or under a frozen
    /// clock, keep the order they were added in instead of falling back to their random ids.
    public static func addTask(
        _ data: StoreData,
        _ input: NewTask,
        parentId: String?,
        _ creation: Creation
    ) -> (data: StoreData, task: TaskItem) {
        let parent = parentId.flatMap { id in data.tasks.first { $0.id == id } }
        let task = TaskItem(
            id: creation.id,
            parentId: parent?.id,
            order: parent.map { Subtasks.nextSiblingOrder(data.tasks, $0.id) } ?? 0,
            title: input.title,
            projectId: parent.map(\.projectId) ?? input.projectId,
            labelIds: input.labelIds,
            due: input.due,
            recurrence: input.recurrence,
            priority: input.priority ?? .default,
            reminders: input.reminders,
            createdAt: max(creation.now, (data.tasks.last?.createdAt ?? Int.min) &+ 1)
        )
        var next = data
        next.tasks = data.tasks + [task]
        if let parent { next.tasks = put(next.tasks, Subtasks.reopenTask(next.tasks, parent.id)) }
        return (next, task)
    }

    /// A new project applies to every subtask under the task too.
    public static func updateTask(_ data: StoreData, _ id: String, _ patch: TaskPatch) -> StoreData {
        guard var task = data.tasks.first(where: { $0.id == id }) else { return data }
        patch.apply(to: &task)
        var changed = [task]
        if let projectId = patch.projectId {
            changed += Subtasks.descendantsOf(data.tasks, id).map { t in
                var t = t
                t.projectId = projectId
                return t
            }
        }
        var next = data
        next.tasks = put(data.tasks, changed)
        return next
    }

    public static func completeTask(
        _ data: StoreData,
        _ id: String,
        today: DateKey,
        now: Int
    ) -> (data: StoreData, completion: Completion)? {
        guard let result = Subtasks.completeTask(data.tasks, id, today: today, now: now) else { return nil }
        let byId = Dictionary(data.tasks.map { ($0.id, $0) }, uniquingKeysWith: { _, last in last })
        let previous = result.changed.map { changed in
            let old = byId[changed.id]!
            return CompletionState(id: old.id, completedAt: old.completedAt, due: old.due, reminders: old.reminders)
        }
        let next: Due? = if case let .rolled(due, _) = result { due } else { nil }
        var updated = data
        updated.tasks = put(data.tasks, result.changed)
        return (updated, Completion(next: next, previous: previous))
    }

    public static func reopenTask(_ data: StoreData, _ id: String) -> StoreData {
        var next = data
        next.tasks = put(data.tasks, Subtasks.reopenTask(data.tasks, id))
        return next
    }

    /// Puts back what a completion changed, as its undo captured it.
    public static func restoreCompletion(_ data: StoreData, _ previous: [CompletionState]) -> StoreData {
        let byId = Dictionary(previous.map { ($0.id, $0) }, uniquingKeysWith: { _, last in last })
        var next = data
        next.tasks = data.tasks.map { task in
            guard let state = byId[task.id] else { return task }
            var task = task
            task.completedAt = state.completedAt
            task.due = state.due
            task.reminders = state.reminders
            return task
        }
        return next
    }

    public static func moveSubtask(_ data: StoreData, _ id: String, _ index: Int) -> StoreData {
        var next = data
        next.tasks = put(data.tasks, Subtasks.moveSubtask(data.tasks, id, index))
        return next
    }

    /// Deletes the task with every subtask under it, and returns them for undo.
    public static func deleteTask(_ data: StoreData, _ id: String) -> (data: StoreData, removed: [TaskItem]) {
        guard let task = data.tasks.first(where: { $0.id == id }) else { return (data, []) }
        let removed = [task] + Subtasks.descendantsOf(data.tasks, id)
        let ids = Set(removed.map(\.id))
        var next = data
        next.tasks = data.tasks.filter { !ids.contains($0.id) }
        return (next, removed)
    }

    public static func undeleteTasks(_ data: StoreData, _ removed: [TaskItem]) -> StoreData {
        let ids = Set(data.tasks.map(\.id))
        var next = data
        next.tasks = sortTasks(data.tasks + removed.filter { !ids.contains($0.id) })
        return next
    }

    public static func addProject(_ data: StoreData, _ name: String, _ creation: Creation) -> (data: StoreData, project: Project) {
        let project = Project(id: creation.id, name: name, createdAt: creation.now)
        var next = data
        next.projects.append(project)
        return (next, project)
    }

    public static func renameProject(_ data: StoreData, _ id: String, _ name: String) -> StoreData {
        var next = data
        next.projects = data.projects.map { p in
            guard p.id == id else { return p }
            var p = p
            p.name = name
            return p
        }
        return next
    }

    /// Deleting a project deletes its tasks, subtasks included, since they share their root's project.
    public static func deleteProject(_ data: StoreData, _ id: String) -> StoreData {
        var next = data
        next.projects = data.projects.filter { $0.id != id }
        next.tasks = data.tasks.filter { $0.projectId != id }
        return next
    }

    public static func addLabel(_ data: StoreData, _ name: String, _ creation: Creation) -> (data: StoreData, label: Label) {
        let label = Label(id: creation.id, name: name, createdAt: creation.now)
        var next = data
        next.labels.append(label)
        return (next, label)
    }

    /// Names stay unique ignoring case, since `@name` must resolve to one label.
    public static func renameLabel(_ data: StoreData, _ id: String, _ name: String) -> StoreData {
        if data.labels.contains(where: { $0.id != id && $0.name.lowercased() == name.lowercased() }) { return data }
        var next = data
        next.labels = data.labels.map { l in
            guard l.id == id else { return l }
            var l = l
            l.name = name
            return l
        }
        return next
    }

    /// Unlike a project, a label owns no tasks, so deleting it only takes it off them.
    public static func deleteLabel(_ data: StoreData, _ id: String) -> StoreData {
        var next = data
        next.labels = data.labels.filter { $0.id != id }
        next.tasks = data.tasks.map { t in
            guard t.labelIds.contains(id) else { return t }
            var t = t
            t.labelIds.removeAll { $0 == id }
            return t
        }
        return next
    }
}
