import Foundation

public typealias StoreData = API.StoreData
public typealias Creation = API.Creation
public typealias NewTask = API.NewTask
public typealias TaskPatch = API.TaskEdit
public typealias CompletionState = API.CompletionState
public typealias Completion = API.Completion
public typealias ExplodeMethod = API.ExplodeMethod
public typealias ExplodedState = API.ExplodedState
public typealias Deleted = API.Deleted

extension API.TaskEdit {
    func apply(to task: inout TaskItem) {
        if let title { task.title = title }
        if let notes { task.notes = notes }
        if let projectId { task.projectId = projectId }
        if let sectionId { task.sectionId = sectionId }
        if let labelIds { task.labelIds = labelIds }
        if let due { task.due = due }
        if let recurrence { task.recurrence = recurrence }
        if let priority { task.priority = priority }
        if let reminders { task.reminders = reminders }
        if let location { task.location = location }
        if let event { task.event = event }
        if let images { task.images = images }
    }
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

    static func put(_ tasks: [TaskItem], _ changed: [TaskItem]) -> [TaskItem] {
        let byId = Dictionary(changed.map { ($0.id, $0) }, uniquingKeysWith: { _, last in last })
        return tasks.map { byId[$0.id] ?? $0 }
    }

    /// A section puts a top-level task in that section and its project, as in `updateTask`.
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
        let section = parent == nil ? input.sectionId.flatMap { id in data.sections.first { $0.id == id } } : nil
        let task = TaskItem(
            id: creation.id,
            parentId: parent?.id,
            order: parent.map { Subtasks.nextSiblingOrder(data.tasks, $0.id) } ?? 0,
            title: input.title,
            projectId: parent.map(\.projectId) ?? section?.projectId ?? input.projectId,
            sectionId: section?.id,
            labelIds: input.labelIds,
            due: input.due,
            recurrence: input.recurrence,
            priority: input.priority ?? .default,
            reminders: input.reminders,
            location: input.location,
            event: input.event,
            createdAt: max(creation.now, (data.tasks.last?.createdAt ?? Int.min) &+ 1)
        )
        var next = data
        next.tasks = data.tasks + [task]
        if let parent { next.tasks = put(next.tasks, Subtasks.reopenTask(next.tasks, parent.id)) }
        return (next, task)
    }

    /// A section moves a top-level task into the section's project, and a new project without a section leaves it in
    /// none. Only top-level tasks sit in a section; a subtask shows under its parent. A new project applies to every
    /// subtask under the task too.
    public static func updateTask(_ data: StoreData, _ id: String, _ patch: TaskPatch) -> StoreData {
        guard let original = data.tasks.first(where: { $0.id == id }) else { return data }
        var task = original
        patch.apply(to: &task)
        let movesProject = patch.projectId.map { $0 != original.projectId } ?? false
        if patch.sectionId != nil || movesProject {
            let section = patch.sectionId.flatMap { $0 }.flatMap { id in data.sections.first { $0.id == id } }
            if let section, original.parentId == nil { task.projectId = section.projectId }
            task.sectionId = original.parentId == nil ? section?.id : nil
        }
        var changed = [task]
        if patch.projectId != nil || patch.sectionId != nil {
            changed += Subtasks.descendantsOf(data.tasks, id).map { t in
                var t = t
                t.projectId = task.projectId
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
        now: Int,
        in zone: TimeZone
    ) -> (data: StoreData, completion: Completion)? {
        guard let result = Subtasks.completeTask(data.tasks, id, today: today, now: now, in: zone) else { return nil }
        let byId = Dictionary(data.tasks.map { ($0.id, $0) }, uniquingKeysWith: { _, last in last })
        let previous = result.changed.map { changed in
            let old = byId[changed.id]!
            return CompletionState(
                id: old.id,
                completedAt: old.completedAt,
                lastCompletedAt: old.lastCompletedAt,
                due: old.due,
                reminders: old.reminders,
                event: old.event
            )
        }
        let next: Due? = if case let .rolled(due, _) = result { due } else { nil }
        var updated = data
        updated.tasks = put(data.tasks, result.changed)
        return (updated, Completion(kind: next == nil ? .done : .rolled, previous: previous, next: next))
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
            task.lastCompletedAt = state.lastCompletedAt
            task.due = state.due
            task.reminders = state.reminders
            task.event = state.event
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

    /// Turns a task's direct subtasks into tasks of their own, one level up: top-level tasks for a top-level parent,
    /// else siblings right after it, in their order. Each keeps its own subtasks. The parent stays, without them.
    /// Returns the subtasks as they were, for undo.
    public static func explodeSubtasks(
        _ data: StoreData,
        _ id: String,
        _ method: ExplodeMethod
    ) -> (data: StoreData, previous: [ExplodedState]) {
        guard let parent = data.tasks.first(where: { $0.id == id }),
              let children = Subtasks.groupChildren(data.tasks)[id], !children.isEmpty
        else { return (data, []) }
        let nextOrder = parent.parentId.flatMap { grandparent in
            data.tasks
                .filter { $0.parentId == grandparent && $0.id != id && Subtasks.siblingOrder(parent, $0) == true }
                .stableSorted(by: Subtasks.siblingOrder)
                .first?.order
        }
        let count = Double(children.count)
        let gap = nextOrder.map { $0 - parent.order } ?? count + 1
        let changed = children.enumerated().map { index, child in
            var moved = child
            moved.parentId = parent.parentId
            moved.order = parent.parentId == nil ? 0 : parent.order + Double(index + 1) * gap / (count + 1)
            // Children of a top-level task land beside it, in its section.
            moved.sectionId = parent.parentId == nil ? parent.sectionId : nil
            switch method {
            case .direct:
                break
            case .prefix:
                moved.title = "\(parent.title): \(child.title)"
            case .inherit:
                if child.labelIds.isEmpty { moved.labelIds = parent.labelIds }
                if child.due == nil, child.event == nil { moved.due = parent.due }
                if child.priority == .default { moved.priority = parent.priority }
            }
            return moved
        }
        let previous = children.map {
            ExplodedState(
                id: $0.id, parentId: $0.parentId, order: $0.order, sectionId: $0.sectionId, title: $0.title,
                labelIds: $0.labelIds, due: $0.due, priority: $0.priority
            )
        }
        var next = data
        next.tasks = put(data.tasks, changed)
        return (next, previous)
    }

    /// Puts back what exploding subtasks changed, as its undo captured it. A subtask whose parent was deleted since
    /// stays where it is, so it never goes unreachable.
    public static func restoreExploded(_ data: StoreData, _ previous: [ExplodedState]) -> StoreData {
        let byId = Dictionary(previous.map { ($0.id, $0) }, uniquingKeysWith: { _, last in last })
        let ids = Set(data.tasks.map(\.id))
        var next = data
        next.tasks = data.tasks.map { task in
            guard let state = byId[task.id] else { return task }
            var task = task
            if state.parentId.map(ids.contains) ?? true {
                task.parentId = state.parentId
                task.order = state.order
                task.sectionId = state.sectionId
            }
            task.title = state.title
            task.labelIds = state.labelIds
            task.due = state.due
            task.priority = state.priority
            return task
        }
        return next
    }

    public static func addProject(_ data: StoreData, _ name: String, _ creation: Creation) -> (data: StoreData, project: Project) {
        let project = Project(
            id: creation.id,
            name: name,
            order: projectsInOrder(data.projects).last.map { $0.order + 1 } ?? 0,
            createdAt: creation.now
        )
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

    /// Deleting a project deletes its sections and tasks, subtasks included, since they share their root's project.
    public static func deleteProject(_ data: StoreData, _ id: String) -> StoreData {
        var next = data
        next.projects = data.projects.filter { $0.id != id }
        next.sections = data.sections.filter { $0.projectId != id }
        next.tasks = data.tasks.filter { $0.projectId != id }
        return next
    }

    /// Projects as the user ordered them. The stored list stays in creation order, like every synced list.
    public static func projectsInOrder(_ projects: [Project]) -> [Project] { siblingOrder(projects) }

    /// Writes only the moved project's `order`, like a section move.
    public static func moveProject(_ data: StoreData, _ id: String, _ index: Int) -> StoreData {
        let orders = moveOrders(data.projects, id, index)
        guard !orders.isEmpty else { return data }
        var next = data
        next.projects = data.projects.map { p in
            guard let order = orders[p.id] else { return p }
            var p = p
            p.order = order
            return p
        }
        return next
    }

    /// A project's sections in their order: by `order`, then `createdAt`, then `id`, like subtasks.
    public static func sectionsOf(_ sections: [ProjectSection], _ projectId: String) -> [ProjectSection] {
        siblingOrder(sections.filter { $0.projectId == projectId })
    }

    private static func siblingOrder<T: Ordered>(_ items: [T]) -> [T] {
        items.stableSorted { a, b in
            if a.order != b.order { return a.order < b.order }
            if a.createdAt != b.createdAt { return a.createdAt < b.createdAt }
            if a.id != b.id { return a.id.utf16.lexicographicallyPrecedes(b.id.utf16) }
            return nil
        }
    }

    /// The orders to write to move `id` to `index`: only the moved one's, or every sibling's new position when the gap
    /// is too small to split. `moveOrders` in `shared/order.ts`.
    private static func moveOrders<T: Ordered>(_ items: [T], _ id: String, _ index: Int) -> [String: Double] {
        guard let moved = items.first(where: { $0.id == id }) else { return [:] }
        let siblings = siblingOrder(items)
        let others = siblings.filter { $0.id != id }
        let at = max(0, min(index, others.count))
        let previous = at > 0 ? others[at - 1].order : nil
        let following = at < others.count ? others[at].order : nil
        var orders: [String: Double] = [:]
        if let previous, let following, following - previous < Subtasks.minOrderGap {
            var placed = others
            placed.insert(moved, at: at)
            for (order, s) in placed.enumerated() where s.order != Double(order) { orders[s.id] = Double(order) }
        } else if siblings.firstIndex(where: { $0.id == id }) != at {
            switch (previous, following) {
            case (nil, nil): orders[id] = 0
            case let (nil, following?): orders[id] = following - 1
            case let (previous?, nil): orders[id] = previous + 1
            case let (previous?, following?): orders[id] = (previous + following) / 2
            }
        }
        return orders
    }

    private static func sameName(_ a: String, _ b: String) -> Bool { a.lowercased() == b.lowercased() }

    /// Adds a section last in its project. Names stay unique in a project ignoring case, since `/name` must resolve to
    /// one section, so a taken name returns the section that has it.
    public static func addSection(
        _ data: StoreData,
        _ projectId: String,
        _ name: String,
        _ creation: Creation
    ) -> (data: StoreData, section: ProjectSection) {
        if let existing = data.sections.first(where: { $0.projectId == projectId && sameName($0.name, name) }) {
            return (data, existing)
        }
        let last = sectionsOf(data.sections, projectId).last
        let section = ProjectSection(
            id: creation.id,
            projectId: projectId,
            name: name,
            order: last.map { $0.order + 1 } ?? 0,
            createdAt: creation.now
        )
        var next = data
        next.sections.append(section)
        return (next, section)
    }

    public static func renameSection(_ data: StoreData, _ id: String, _ name: String) -> StoreData {
        guard let section = data.sections.first(where: { $0.id == id }),
              !data.sections.contains(where: { $0.id != id && $0.projectId == section.projectId && sameName($0.name, name) })
        else { return data }
        var next = data
        next.sections = data.sections.map { s in
            guard s.id == id else { return s }
            var s = s
            s.name = name
            return s
        }
        return next
    }

    /// Writes only the moved section's `order`, like a subtask move.
    public static func moveSection(_ data: StoreData, _ id: String, _ index: Int) -> StoreData {
        guard let section = data.sections.first(where: { $0.id == id }) else { return data }
        let orders = moveOrders(data.sections.filter { $0.projectId == section.projectId }, id, index)
        guard !orders.isEmpty else { return data }
        var next = data
        next.sections = data.sections.map { s in
            guard let order = orders[s.id] else { return s }
            var s = s
            s.order = order
            return s
        }
        return next
    }

    /// Every task in a section, done ones and subtasks included: what deleting it removes, so its prompt can count them.
    public static func sectionTasks(_ tasks: [TaskItem], _ id: String) -> [TaskItem] {
        tasks.filter { $0.sectionId == id }.flatMap { [$0] + Subtasks.descendantsOf(tasks, $0.id) }
    }

    /// Deleting a section deletes its tasks with their subtasks, as Todoist does and as deleting a project does.
    public static func deleteSection(_ data: StoreData, _ id: String) -> StoreData {
        let removed = Set(sectionTasks(data.tasks, id).map(\.id))
        var next = data
        next.sections = data.sections.filter { $0.id != id }
        next.tasks = data.tasks.filter { !removed.contains($0.id) }
        return next
    }

    public static func addLabel(_ data: StoreData, _ name: String, _ creation: Creation) -> (data: StoreData, label: Label) {
        let label = Label(id: creation.id, name: name, color: LabelColors.defaultLabelColor(name), createdAt: creation.now)
        var next = data
        next.labels.append(label)
        return (next, label)
    }

    /// Rewrites the place of every open task at `key`, so its rows read the saved name and it watches the saved radius.
    private static func relocate(_ tasks: [TaskItem], _ key: String, name: String? = nil, radius: Double? = nil) -> [TaskItem] {
        tasks.map { t in
            guard t.completedAt == nil, var location = t.location, Triggers.placeKey(location) == key else { return t }
            var t = t
            if let name { location.name = name }
            if let radius { location.radius = radius }
            t.location = location
            return t
        }
    }

    /// Saves a place under a name, as a label that holds it. A name another label has is refused and returns no label,
    /// since `@name` must resolve to one label. The open tasks already at the place take its name and radius.
    public static func savePlace(
        _ data: StoreData,
        _ name: String,
        _ place: SavedPlace,
        _ creation: Creation
    ) -> (data: StoreData, label: Label?) {
        if data.labels.contains(where: { $0.name.lowercased() == name.lowercased() }) { return (data, nil) }
        let label = Label(
            id: creation.id,
            name: name,
            color: LabelColors.defaultLabelColor(name),
            place: place,
            createdAt: creation.now
        )
        var next = data
        next.labels.append(label)
        next.tasks = relocate(data.tasks, Triggers.placeKey(place), name: name, radius: place.radius)
        return (next, label)
    }

    /// A saved place's new radius reaches the open tasks at it, like saving it did.
    public static func setPlaceRadius(_ data: StoreData, _ id: String, _ radius: Double) -> StoreData {
        guard let place = data.labels.first(where: { $0.id == id })?.place else { return data }
        var next = data
        next.labels = data.labels.map { l in
            guard l.id == id else { return l }
            var l = l
            l.place?.radius = radius
            return l
        }
        next.tasks = relocate(data.tasks, Triggers.placeKey(place), radius: radius)
        return next
    }

    /// A suggested color for a label created as `created`, or nil when there is nothing to apply. The label must still
    /// have the name and color it was created with, so a rename or a color picked meanwhile, here or on another device,
    /// wins over the suggestion.
    public static func suggestLabelColor(_ data: StoreData, _ created: Label, _ color: LabelColor) -> StoreData? {
        guard color != created.color,
              let current = data.labels.first(where: { $0.id == created.id }),
              current.name == created.name, current.color == created.color
        else { return nil }
        return setLabelColor(data, created.id, color)
    }

    public static func setLabelColor(_ data: StoreData, _ id: String, _ color: LabelColor) -> StoreData {
        var next = data
        next.labels = data.labels.map { l in
            guard l.id == id else { return l }
            var l = l
            l.color = color
            return l
        }
        return next
    }

    /// Names stay unique ignoring case, since `@name` must resolve to one label. Renaming a saved place renames it on
    /// the open tasks at it.
    public static func renameLabel(_ data: StoreData, _ id: String, _ name: String) -> StoreData {
        if data.labels.contains(where: { $0.id != id && $0.name.lowercased() == name.lowercased() }) { return data }
        guard let label = data.labels.first(where: { $0.id == id }) else { return data }
        var next = data
        next.labels = data.labels.map { l in
            guard l.id == id else { return l }
            var l = l
            l.name = name
            return l
        }
        if let place = label.place { next.tasks = relocate(data.tasks, Triggers.placeKey(place), name: name) }
        return next
    }

    /// Unlike a project, a label owns no tasks, so deleting it only takes it off them. A deleted place stays on its tasks.
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

    /// What a delete took out of `before` to leave `after`, for `undelete`.
    public static func deletedBetween(_ before: StoreData, _ after: StoreData) -> Deleted {
        func gone<T: Created>(_ was: [T], _ now: [T]) -> [T] {
            let live = Set(now.map(\.id))
            return was.filter { !live.contains($0.id) }
        }
        let kept = Dictionary(after.tasks.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        return Deleted(
            projects: gone(before.projects, after.projects),
            sections: gone(before.sections, after.sections),
            labels: gone(before.labels, after.labels),
            tasks: gone(before.tasks, after.tasks),
            labelings: before.tasks.flatMap { t -> [API.Labeling] in
                guard let now = kept[t.id] else { return [] }
                return t.labelIds.enumerated().compactMap { index, labelId in
                    now.labelIds.contains(labelId) ? nil : API.Labeling(taskId: t.id, labelId: labelId, index: index)
                }
            }
        )
    }

    /// Puts back what a delete removed. A task edited since keeps its edits, and gets each removed label back at its
    /// old place in `labelIds`, or last when the list has since shrunk. A section or task whose project was deleted
    /// since stays gone, since undoing a section delete after its project's delete must not bring back tasks no view
    /// shows.
    public static func undelete(_ data: StoreData, _ deleted: Deleted) -> StoreData {
        func missing<T: Created>(_ live: [T], _ gone: [T]) -> [T] {
            let ids = Set(live.map(\.id))
            return gone.filter { !ids.contains($0.id) }
        }
        // Synced lists stay in creation order, so each one comes back at its place in it.
        func restore<T: Created>(_ live: [T], _ gone: [T]) -> [T] {
            var list = live
            for e in missing(live, gone) {
                let at = list.firstIndex { x in
                    x.createdAt != e.createdAt ? x.createdAt > e.createdAt : e.id.utf16.lexicographicallyPrecedes(x.id.utf16)
                } ?? list.endIndex
                list.insert(e, at: at)
            }
            return list
        }
        var next = data
        next.projects = restore(data.projects, deleted.projects)
        let live = Set(next.projects.map(\.id))
        next.sections = restore(data.sections, deleted.sections.filter { live.contains($0.projectId) })
        next.labels = restore(data.labels, deleted.labels)
        let returning = deleted.tasks.filter { $0.projectId.map(live.contains) ?? true }
        next.tasks = sortTasks((data.tasks + missing(data.tasks, returning)).map { t in
            let back = deleted.labelings
                .filter { $0.taskId == t.id && !t.labelIds.contains($0.labelId) }
                .stableSorted { a, b in a.index == b.index ? nil : a.index < b.index }
            guard !back.isEmpty else { return t }
            var t = t
            for labeling in back { t.labelIds.insert(labeling.labelId, at: min(labeling.index, t.labelIds.count)) }
            return t
        })
        return next
    }
}

/// What restoring a deleted record in creation order needs.
protocol Created {
    var id: String { get }
    var createdAt: Int { get }
}

extension Project: Created {}
extension ProjectSection: Created {}
extension Label: Created {}
extension TaskItem: Created {}

/// What fractional sibling order needs: projects and sections both sort and move by it.
protocol Ordered {
    var id: String { get }
    var order: Double { get }
    var createdAt: Int { get }
}

extension Project: Ordered {}
extension ProjectSection: Ordered {}
