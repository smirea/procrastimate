import Core
import Foundation
import GRDB
import PowerSync
import PowerSyncGRDB

/// The device's PowerSync database, `Application Support/procrastimate/procrastimate.sqlite`. GRDB reads and writes
/// it through PowerSync's views of the synced tables; PowerSync queues every local write for upload and applies
/// what the server streams.
final class LocalDatabase: Sendable {
    static var url: URL { StoreLocation.directory.appending(path: "procrastimate.sqlite") }

    let pool: DatabasePool
    let powerSync: PowerSyncDatabaseProtocol

    init() throws {
        try FileManager.default.createDirectory(at: StoreLocation.directory, withIntermediateDirectories: true)
        var configuration = Configuration()
        try configuration.configurePowerSync(schema: syncSchema)
        pool = try DatabasePool(path: Self.url.path, configuration: configuration)
        powerSync = openPowerSyncWithGRDB(
            pool: pool, schema: syncSchema, identifier: Self.url.lastPathComponent,
            logger: DefaultLogger(minSeverity: .warning)
        )
    }

    /// PowerSync creates its tables on its first call, so a fresh file has none until this returns. The change log and
    /// its triggers come after them.
    func ready() async throws {
        _ = try await powerSync.getPowerSyncVersion()
        try await pool.write { db in
            for statement in changeLogStatements { try db.execute(sql: statement) }
        }
    }

    /// The local-only log the generated triggers fill with every synced row a local write or a sync touches.
    private enum Change: TableRecord {
        static let databaseTableName = changeLogTable
        static let seq = Column("seq")
        static let table = Column("tbl")
        static let id = Column("id")
    }

    /// `cursor` is the newest change the read covers, nil while the log does not exist yet, and `logged` how many
    /// changes the log holds.
    struct Read: Sendable {
        let cursor: Int64?
        let logged: Int64
        let changes: RowsRead

        /// Whether the log is long enough for `trim`.
        var long: Bool { logged > LocalDatabase.trimAbove }
    }

    /// Past this many entries a reader trims the log to the newest `keptChanges`; a reader further behind reads
    /// everything.
    fileprivate static let trimAbove: Int64 = 10000
    private static let keptChanges: Int64 = 1000
    /// Past this many changed ids a table is read whole, which also keeps its query under SQLite's variable limit.
    private static let wholeTableAbove = 500

    /// The latest change, which the sync client observes instead of every synced table.
    static func lastChange(_ db: Database) throws -> Int64? {
        try Int64.fetchOne(db, Change.select(max(Change.seq)))
    }

    /// What changed since `cursor`: the ids the log names and the rows that still have them. Every table whole when
    /// there is no cursor yet or the log no longer reaches back to it. GRDB reads in one transaction, so a sync applying
    /// between two tables cannot tear the result.
    static func read(since cursor: Int64?, _ db: Database) throws -> Read {
        guard try db.tableExists(changeLogTable) else {
            return Read(cursor: nil, logged: 0, changes: RowsRead(everything: try rows(db)))
        }
        let bounds = try Row.fetchOne(db, Change.select(min(Change.seq), max(Change.seq)))
        let first: Int64? = bounds?[0]
        let last: Int64 = bounds?[1] ?? 0
        let logged = first.map { last - $0 + 1 } ?? 0
        guard let cursor, first.map({ $0 <= cursor + 1 }) ?? true else {
            return Read(cursor: last, logged: logged, changes: RowsRead(everything: try rows(db)))
        }
        guard last > cursor else { return Read(cursor: cursor, logged: logged, changes: RowsRead()) }
        let named = try Row.fetchAll(
            db, Change.select(Change.table, Change.id).distinct().filter(Change.seq > cursor && Change.seq <= last)
        )
        let ids = Dictionary(grouping: named) { $0[Change.table] as String }.mapValues { $0.map { $0[Change.id] as String } }
        var changes = RowsRead()
        changes.tasks = try changed(db, TaskItem.self, ids)
        changes.projects = try changed(db, Project.self, ids)
        changes.sections = try changed(db, ProjectSection.self, ids)
        changes.labels = try changed(db, Label.self, ids)
        changes.comments = try changed(db, Comment.self, ids)
        changes.reads = try changed(db, CommentRead.self, ids)
        changes.settings = try changed(db, API.Settings.self, ids)
        changes.access = try ids[Access.layout.table].map { ids in
            let whole = ids.count > wholeTableAbove
            return TableRead(ids: whole ? .all : .some(ids), rows: try decoded(db, Access.self, whole ? nil : ids).map(\.value))
        }
        return Read(cursor: last, logged: logged, changes: changes)
    }

    /// Trims the log once it is long; trimming twice is harmless.
    func trim(after read: Read) async throws {
        guard read.long, let cursor = read.cursor else { return }
        _ = try await pool.write { try Change.filter(Change.seq <= cursor - Self.keptChanges).deleteAll($0) }
    }

    /// Every synced row. A row that does not decode is left out and logged, so one bad row never hides the rest.
    static func rows(_ db: Database) throws -> StoredRows {
        var rows = StoredRows()
        rows.tasks = try owned(db, TaskItem.self)
        rows.projects = try owned(db, Project.self)
        rows.sections = try owned(db, ProjectSection.self)
        rows.labels = try owned(db, Label.self)
        rows.comments = try owned(db, Comment.self)
        rows.reads = try owned(db, CommentRead.self)
        rows.settings = try owned(db, API.Settings.self)
        rows.access = try decoded(db, Access.self).map(\.value)
        return rows
    }

    private static func changed<V: SyncedValue>(_ db: Database, _: V.Type, _ ids: [String: [String]]) throws -> TableRead<Owned<V>>? {
        guard let ids = ids[V.layout.table] else { return nil }
        let whole = ids.count > wholeTableAbove
        return TableRead(ids: whole ? .all : .some(ids), rows: try owned(db, V.self, whole ? nil : ids))
    }

    private static func owned<V: SyncedValue>(_ db: Database, _: V.Type, _ ids: [String]? = nil) throws -> [Owned<V>] {
        try decoded(db, V.self, ids).compactMap(\.owned)
    }

    private static func decoded<V: SyncedValue>(_ db: Database, _: V.Type, _ ids: [String]? = nil) throws -> [SyncedRow<V>] {
        let request = ids.map { SyncedRow<V>.filter($0.contains(Column("id"))) } ?? SyncedRow<V>.all()
        return try request.asRequest(of: Row.self).fetchAll(db).compactMap { row in
            do {
                return try SyncedRow<V>(row: row)
            } catch {
                ErrorReport.log("A synced row did not load", about: V.layout.table, error: error)
                return nil
            }
        }
    }

    func write(_ batch: RowBatch) async throws {
        try await pool.write { db in
            for write in batch.writes {
                guard let type = syncedValues[Rows.table(of: write.kind)] else {
                    throw RowCodingError(description: "No table for \(write.kind)")
                }
                try Self.apply(write, owner: batch.owner, type, db)
            }
        }
    }

    /// GRDB's `upsert` fails on a view and `save` of a new record writes nothing, so each op picks `insert`,
    /// `updateChanges`, or `delete` itself. `updateChanges` compares GRDB's own encoding of the row before and after,
    /// so only the columns that changed are written and queued, never a JSON column the server spelled differently.
    private static func apply<V: SyncedValue>(_ write: RowWrite, owner: String, _: V.Type, _ db: Database) throws {
        if write.op == .delete {
            try SyncedRow<V>.deleteOne(db, key: write.id)
            return
        }
        let existing = try SyncedRow<V>.fetchOne(db, key: write.id)
        let base: JSONValue
        if let existing {
            base = try JSONValue.encoded(existing.value)
        } else if write.op == .put {
            base = .object([:])
        } else {
            // A patch of a row that is gone changes nothing, as on the server. The store holds a settings change until
            // the server's row arrives, so no settings row is ever made here.
            return
        }
        guard case var .object(fields) = base else { return }
        fields.merge(write.values ?? [:]) { _, new in new }
        fields["id"] = .string(write.id)
        // A row write spells a missing `sourceKey` as null, which the Core type reads as absent.
        for column in V.layout.columns where !column.required && fields[column.key] == .null {
            fields[column.key] = nil
        }
        let value: V = try JSONValue.object(fields).decoded()
        if var existing {
            try existing.updateChanges(db) { $0.value = value }
        } else {
            try SyncedRow(id: write.id, owner: owner, value: value).insert(db)
        }
    }
}
