import Foundation

/// The rows a read covered: every row of a table, or the ones with these ids.
public enum ReadIds: Sendable {
    case all
    case some([String])
}

/// One table's part of a read of the local database: the ids it covered and the rows that still have them.
public struct TableRead<Row: Sendable>: Sendable {
    public var ids: ReadIds
    public var rows: [Row]

    public init(ids: ReadIds, rows: [Row]) {
        self.ids = ids
        self.rows = rows
    }
}

/// What one read of the change log found, by table. A table it did not touch is nil.
public struct RowsRead: Sendable {
    public var tasks: TableRead<Owned<TaskItem>>?
    public var projects: TableRead<Owned<Project>>?
    public var sections: TableRead<Owned<ProjectSection>>?
    public var labels: TableRead<Owned<Label>>?
    public var comments: TableRead<Owned<Comment>>?
    public var reads: TableRead<Owned<CommentRead>>?
    public var settings: TableRead<Owned<API.Settings>>?
    public var access: TableRead<Access>?

    public init() {}

    /// Every table whole.
    public init(everything rows: StoredRows) {
        tasks = TableRead(ids: .all, rows: rows.tasks)
        projects = TableRead(ids: .all, rows: rows.projects)
        sections = TableRead(ids: .all, rows: rows.sections)
        labels = TableRead(ids: .all, rows: rows.labels)
        comments = TableRead(ids: .all, rows: rows.comments)
        reads = TableRead(ids: .all, rows: rows.reads)
        settings = TableRead(ids: .all, rows: rows.settings)
        access = TableRead(ids: .all, rows: rows.access)
    }
}

/// The port of `shared/local-rows.ts`: the local database as last read, grouped into spaces by `user_id`. The sync
/// client applies every read of the change log to it, so each read touches only the rows it names and only the spaces
/// those rows live in are built again. It holds the stored rows rather than what the store shows: a reference to a row
/// that is gone reads as empty (`Dangling.resolveDangling`) only until the row comes back. Read markers and settings are
/// only ever the user's own.
public final class LocalRows {
    public let me: String
    public private(set) var spaces = Spaces()

    private struct OwnerRows {
        var tasks: [String: TaskItem] = [:]
        var projects: [String: Project] = [:]
        var sections: [String: ProjectSection] = [:]
        var labels: [String: Label] = [:]
        var comments: [String: Comment] = [:]
        var reads: [String: CommentRead] = [:]
        var settings: [String: API.Settings] = [:]
        var access: [String: Access] = [:]

        var isEmpty: Bool {
            tasks.isEmpty && projects.isEmpty && sections.isEmpty && labels.isEmpty && comments.isEmpty && reads.isEmpty
                && settings.isEmpty && access.isEmpty
        }

        func snapshot(own: Bool) -> Snapshot {
            Spaces.sorted(Snapshot(
                tasks: Array(tasks.values), projects: Array(projects.values), sections: Array(sections.values),
                labels: Array(labels.values), comments: Array(comments.values), reads: own ? Array(reads.values) : [],
                settings: settings[Rows.settingsID] ?? API.Settings()
            ))
        }
    }

    private struct RowKey: Hashable {
        let table: String
        let id: String
    }

    private var owners: [String: OwnerRows] = [:]
    private var ownerOf: [RowKey: String] = [:]

    public init(me: String) {
        self.me = me
    }

    /// Applies a read and returns the owners whose rows it changed, sorted.
    @discardableResult
    public func apply(_ read: RowsRead) -> [String] {
        var touched = Set<String>()
        merge(read.tasks, \.tasks, "tasks", id: \.id, &touched)
        merge(read.projects, \.projects, "projects", id: \.id, &touched)
        merge(read.sections, \.sections, "sections", id: \.id, &touched)
        merge(read.labels, \.labels, "labels", id: \.id, &touched)
        merge(read.comments, \.comments, "comments", id: \.id, &touched)
        merge(read.reads, \.reads, "reads", id: \.id, ownOnly: true, &touched)
        merge(read.settings, \.settings, "settings", id: { _ in Rows.settingsID }, ownOnly: true, &touched)
        let access = read.access.map { TableRead(ids: $0.ids, rows: $0.rows.map { Owned(owner: $0.owner, value: $0) }) }
        merge(access, \.access, "access", id: \.id, &touched)
        for owner in touched where owners[owner]?.isEmpty == true {
            owners[owner] = nil
        }
        rebuild(touched)
        return touched.sorted()
    }

    private func merge<V>(
        _ table: TableRead<Owned<V>>?,
        _ path: WritableKeyPath<OwnerRows, [String: V]>,
        _ name: String,
        id: (V) -> String,
        ownOnly: Bool = false,
        _ touched: inout Set<String>
    ) {
        guard let table else { return }
        func drop(_ id: String) {
            guard let owner = ownerOf.removeValue(forKey: RowKey(table: name, id: id)) else { return }
            owners[owner]?[keyPath: path][id] = nil
            touched.insert(owner)
        }
        switch table.ids {
        case .all:
            for rows in owners.values {
                for id in rows[keyPath: path].keys { drop(id) }
            }
        case let .some(ids):
            for id in ids { drop(id) }
        }
        for row in table.rows where !ownOnly || row.owner == me {
            let id = id(row.value)
            owners[row.owner, default: OwnerRows()][keyPath: path][id] = row.value
            ownerOf[RowKey(table: name, id: id)] = row.owner
            touched.insert(row.owner)
        }
    }

    private func rebuild(_ touched: Set<String>) {
        for owner in touched {
            if owner == me {
                spaces.own = owners[me]?.snapshot(own: true) ?? .empty
                spaces.settingsStored = owners[me]?.settings[Rows.settingsID] != nil
            } else {
                spaces.shared[owner] = owners[owner]?.snapshot(own: false)
            }
        }
        guard touched.contains(where: { $0 != me }) else { return }
        spaces.access = sharers.flatMap { owner in
            owners[owner]!.access.values.sorted { $0.id.utf16.lexicographicallyPrecedes($1.id.utf16) }
        }
    }

    /// Every owner other than the user with something that reaches them, sorted.
    public var sharers: [String] { owners.keys.filter { $0 != me }.sorted() }
}
