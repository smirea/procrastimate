import Foundation

/// The port of `shared/space-routing.ts`: which space each command runs in, the same on both clients. A space is the
/// user's own (`nil`) or one another user shares with them, named by its owner's id, and nothing crosses spaces.
public enum SpaceRouting {
    /// Every shared entity's owner by id; the user's own entities are absent. Ids are UUIDs, so one map serves every kind.
    public typealias Homes = [String: String]

    /// A new task's space: its parent's, else its project's, else the first shared label's, else the user's own.
    public static func creationHome(_ homes: Homes, projectId: String?, labelIds: [String], parentId: String?) -> String? {
        if let parentId { return homes[parentId] }
        if let projectId { return homes[projectId] }
        return labelIds.lazy.compactMap { homes[$0] }.first
    }

    /// A new task without the project, section, and labels of other spaces.
    public static func fitToSpace(_ data: StoreData, _ input: NewTask) -> NewTask {
        var input = input
        input.projectId = input.projectId.flatMap { id in data.projects.contains { $0.id == id } ? id : nil }
        input.sectionId = input.sectionId.flatMap { id in data.sections.contains { $0.id == id } ? id : nil }
        input.labelIds = input.labelIds.filter { id in data.labels.contains { $0.id == id } }
        return input
    }

    /// An edit without moves into another space: a project or section of another space leaves the task where it is, and
    /// labels of another space are dropped. Clearing the project or section still applies.
    public static func fitPatch(_ data: StoreData, _ patch: TaskPatch) -> TaskPatch {
        var patch = patch
        if case let .some(.some(id)) = patch.projectId, !data.projects.contains(where: { $0.id == id }) {
            patch.projectId = nil
        }
        if case let .some(.some(id)) = patch.sectionId, !data.sections.contains(where: { $0.id == id }) {
            patch.sectionId = nil
        }
        patch.labelIds = patch.labelIds?.filter { id in data.labels.contains { $0.id == id } }
        return patch
    }

    public struct SharedEntry: Hashable, Sendable, Identifiable {
        public enum Kind: String, Hashable, Sendable { case project, label, task }

        public let kind: Kind
        public let id: String
        public let name: String
        public let owner: Person
    }

    /// What "Shared with me" lists: the spaces by their owner's name, and in each its projects in their order, its
    /// labels by name, then each top-level task that no project or label of the space leads to.
    public static func sharedEntries(_ spaces: [SharedSpace]) -> [SharedEntry] {
        spaces.stableSorted { a, b in
            let order = UTF16Text.compareBase(a.owner.name, b.owner.name)
            if order != .orderedSame { return order == .orderedAscending }
            return a.owner.id == b.owner.id ? nil : a.owner.id.utf16.lexicographicallyPrecedes(b.owner.id.utf16)
        }
        .flatMap { space in
            let data = space.data
            let projects = Set(data.projects.map(\.id))
            let labels = Set(data.labels.map(\.id))
            let tasks = Set(data.tasks.map(\.id))
            let loose = data.tasks.filter { task in
                !tasks.contains(task.parentId ?? "") && !projects.contains(task.projectId ?? "")
                    && !task.labelIds.contains(where: labels.contains)
            }
            return StoreRules.projectsInOrder(data.projects)
                .map { SharedEntry(kind: .project, id: $0.id, name: $0.name, owner: space.owner) }
                + Browse.labelsByName(data.labels).map { SharedEntry(kind: .label, id: $0.id, name: $0.name, owner: space.owner) }
                + loose.map { SharedEntry(kind: .task, id: $0.id, name: $0.title, owner: space.owner) }
        }
    }
}
