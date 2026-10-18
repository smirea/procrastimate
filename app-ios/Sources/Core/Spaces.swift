import Foundation

/// Where an entity lives for life: the user's own space, or a space someone shared, named by its owner's id.
public enum SpaceKey: Hashable, Sendable {
    case own
    case shared(String)

    /// The `space` query a request for this space sends. The own space sends none.
    public var query: String? {
        if case let .shared(id) = self { id } else { nil }
    }
}

public typealias Access = API.Access

/// A row of the local database with the `user_id` of the space it lives in.
public struct Owned<Value: Hashable & Sendable>: Hashable, Sendable {
    public var owner: String
    public var value: Value

    public init(owner: String, value: Value) {
        self.owner = owner
        self.value = value
    }
}

/// Everything the local database holds, as PowerSync streamed it: the user's own rows, the rows other users share with
/// them, and the `access` rows that say which shared entities they may edit.
public struct StoredRows: Hashable, Sendable {
    public var tasks: [Owned<TaskItem>] = []
    public var projects: [Owned<Project>] = []
    public var sections: [Owned<ProjectSection>] = []
    public var labels: [Owned<Label>] = []
    public var comments: [Owned<Comment>] = []
    public var reads: [Owned<CommentRead>] = []
    public var settings: [Owned<API.Settings>] = []
    public var access: [Access] = []

    public init() {}
}

/// The stored rows grouped into spaces by their `user_id` (`LocalRows`): the signed-in user's own, and one per owner who
/// shares with them. Read markers and settings are only ever the user's own.
public struct Spaces: Hashable, Sendable {
    public var own: Snapshot
    public var shared: [String: Snapshot]
    public var access: [Access]
    /// Whether the rows hold the user's settings row, which the server creates and the first sync brings.
    public var settingsStored: Bool

    public init(own: Snapshot = .empty, shared: [String: Snapshot] = [:], access: [Access] = [], settingsStored: Bool = false) {
        self.own = own
        self.shared = shared
        self.access = access
        self.settingsStored = settingsStored
    }

    public init(_ rows: StoredRows, me: String) {
        let local = LocalRows(me: me)
        local.apply(RowsRead(everything: rows))
        self = local.spaces
    }

    /// The order both clients list entities in, oldest first, with references to rows that are gone read as empty.
    static func sorted(_ snapshot: Snapshot) -> Snapshot {
        var sorted = Dangling.resolveDangling(snapshot)
        sorted.tasks = StoreRules.sortTasks(sorted.tasks)
        sorted.projects = sorted.projects.sorted { ($0.createdAt, $0.id) < ($1.createdAt, $1.id) }
        sorted.sections = sorted.sections.sorted { ($0.createdAt, $0.id) < ($1.createdAt, $1.id) }
        sorted.labels = sorted.labels.sorted { ($0.createdAt, $0.id) < ($1.createdAt, $1.id) }
        sorted.comments = sorted.comments.sorted { ($0.createdAt, $0.id) < ($1.createdAt, $1.id) }
        sorted.reads = sorted.reads.sorted { $0.id < $1.id }
        return sorted
    }
}

/// A space another user shares with this one, with its owner's name when the people cache has it.
public struct SharedSpace: Hashable, Sendable, Identifiable {
    public let id: String
    public let owner: Person
    public let data: Snapshot

    public init(id: String, owner: Person, data: Snapshot) {
        self.id = id
        self.owner = owner
        self.data = data
    }
}

public enum SharedLinks {
    /// The token of a public share link, `https://procrastimate.stf.lol/s/<token>`, which Universal Links open in the
    /// app.
    public static func token(in url: URL) -> String? {
        let path = url.pathComponents
        guard url.scheme == "https", url.host() == "procrastimate.stf.lol", path.count == 3, path[1] == "s",
              !path[2].isEmpty else { return nil }
        return path[2]
    }
}

extension Browse {
    public struct SharedEntry: Hashable, Sendable, Identifiable {
        public enum Kind: Hashable, Sendable { case project, label, task }

        public let kind: Kind
        public let id: String
        public let name: String
        public let owner: Person
    }

    /// What Browse lists under "Shared with me": each shared space's projects, then its labels, then its top-level
    /// tasks outside any project. The `access` rows name every entity a share reaches rather than the shares
    /// themselves, so a label carried by a shared project's task lists too.
    public static func sharedEntries(_ spaces: [SharedSpace]) -> [SharedEntry] {
        spaces.flatMap { space in
            let data = space.data
            let tasks = Set(data.tasks.map(\.id))
            return StoreRules.projectsInOrder(data.projects)
                .map { SharedEntry(kind: .project, id: $0.id, name: $0.name, owner: space.owner) }
                + labelsByName(data.labels).map { SharedEntry(kind: .label, id: $0.id, name: $0.name, owner: space.owner) }
                + data.tasks.filter { $0.projectId == nil && !tasks.contains($0.parentId ?? "") }
                .map { SharedEntry(kind: .task, id: $0.id, name: $0.title, owner: space.owner) }
        }
    }
}
