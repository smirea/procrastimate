import Foundation

/// Ports `shared/shared-link.ts`: what a public link's page lists and its title.
public enum SharedLink {
    /// A project under its sections, like the project view, else one group of open tasks, where a subtask whose parent
    /// is shared too shows under its parent's progress instead.
    public static func groups(_ view: API.SharedView, in zone: TimeZone) -> [Views.ProjectGroup] {
        if view.target.kind == .project { return Views.projectGroups(view.tasks, view.sections, view.target.id, in: zone) }
        let ids = Set(view.tasks.map(\.id))
        let tasks = StoreRules.sortTasks(Triggers.openTasks(view.tasks).filter { $0.parentId.map { !ids.contains($0) } ?? true })
        return [Views.ProjectGroup(section: nil, tasks: tasks)]
    }

    public static func title(_ view: API.SharedView) -> String {
        let id = view.target.id
        return switch view.target.kind {
        case .project: view.projects.first { $0.id == id }?.name ?? "Shared project"
        case .label: view.labels.first { $0.id == id }?.name ?? "Shared label"
        case .task: view.tasks.first { $0.id == id }?.title ?? "Shared task"
        case .space: "\(view.owner.name)’s tasks"
        }
    }
}
