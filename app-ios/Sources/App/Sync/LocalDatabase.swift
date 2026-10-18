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

    /// PowerSync creates its views on its first call, so a fresh file has no tables until this returns.
    func ready() async throws {
        _ = try await powerSync.getPowerSyncVersion()
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

    private static func owned<V: SyncedValue>(_ db: Database, _: V.Type) throws -> [Owned<V>] {
        try decoded(db, V.self).compactMap(\.owned)
    }

    private static func decoded<V: SyncedValue>(_ db: Database, _: V.Type) throws -> [SyncedRow<V>] {
        try SyncedRow<V>.all().asRequest(of: Row.self).fetchAll(db).compactMap { row in
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
