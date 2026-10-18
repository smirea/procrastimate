/// The port of `shared/dangling.ts`: how a reader treats a reference to a row that is gone, since the server never
/// repairs data. Applied in memory when the rows load, never written back.
public enum Dangling {
    /// A subtask whose parent is gone, or whose parents loop, reads as top level. A task in a deleted project reads as
    /// in Inbox, and a subtask's project is its root's. A section of a deleted project is dropped, and a task keeps
    /// its section only while it is top level and the section is a live one of its project. A deleted label leaves
    /// every `labelIds`.
    public static func resolveDangling(_ data: Snapshot) -> Snapshot {
        let projects = Set(data.projects.map(\.id))
        let sections = data.sections.filter { projects.contains($0.projectId) }
        let sectionProject = Dictionary(sections.map { ($0.id, $0.projectId) }, uniquingKeysWith: { _, last in last })
        let labels = Set(data.labels.map(\.id))

        let placed = Subtasks.detachOrphans(data.tasks).map { task in
            var task = task
            if let id = task.projectId, !projects.contains(id) { task.projectId = nil }
            task.labelIds = task.labelIds.filter(labels.contains)
            return task
        }
        let byId = Dictionary(placed.map { ($0.id, $0) }, uniquingKeysWith: { _, last in last })
        func rootProject(_ task: TaskItem) -> String? {
            var root = task
            while let parent = root.parentId { root = byId[parent]! }
            return root.projectId
        }

        var resolved = data
        resolved.sections = sections
        resolved.tasks = placed.map { task in
            var task = task
            task.projectId = rootProject(task)
            if let id = task.sectionId, task.parentId != nil || sectionProject[id].map({ $0 != task.projectId }) ?? true {
                task.sectionId = nil
            }
            return task
        }
        return resolved
    }
}
