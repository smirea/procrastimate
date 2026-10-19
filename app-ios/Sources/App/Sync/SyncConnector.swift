import Core
import Foundation
import PowerSync

/// PowerSync's two calls into the app's server: a token for the sync stream, and the upload of local writes.
final class SyncConnector: PowerSyncBackendConnectorProtocol {
    private let prefetched: @Sendable () async -> PowerSyncCredentials?
    /// The server refused a write; the next checkpoint puts its row back.
    private let rejected: @Sendable ([(kind: EntityKind, id: String)]) async -> Void
    private let signedOut: @Sendable () async -> Void

    init(
        prefetched: @escaping @Sendable () async -> PowerSyncCredentials?,
        rejected: @escaping @Sendable ([(kind: EntityKind, id: String)]) async -> Void,
        signedOut: @escaping @Sendable () async -> Void
    ) {
        self.prefetched = prefetched
        self.rejected = rejected
        self.signedOut = signedOut
    }

    func fetchCredentials() async throws -> PowerSyncCredentials? {
        guard let token = SessionToken.read() else { return nil }
        if let credentials = await prefetched() { return credentials }
        do {
            let sync = try await APIClient.send(API.Endpoints.SyncToken.self, NoInput(), token: token)
            return PowerSyncCredentials(endpoint: sync.endpoint, token: sync.token)
        } catch let failure as APIFailure where failure.isUnauthorized {
            await signedOut()
            return nil
        }
    }

    func uploadData(database: PowerSyncDatabaseProtocol) async throws {
        guard let token = SessionToken.read() else { return }
        guard let batch = try await database.getCrudBatch(limit: 1000) else {
            try await TaskImages.uploadQueued(token: token)
            return
        }
        try await TaskImages.uploadQueued(token: token)
        let databaseID = DeviceDefaults.databaseID
        let writes = try Rows.coalesce(batch.crud.compactMap { try Self.rowWrite($0, databaseID: databaseID) })
        let body = API.UploadRequest(writes: writes.map(Self.wire))
        let response: API.UploadResponse
        do {
            response = try await APIClient.send(API.Endpoints.SyncUpload.self, body, token: token)
        } catch let failure as APIFailure where failure.isUnauthorized {
            await signedOut()
            throw failure
        }
        let refused = response.rejected.compactMap { item in Rows.kind(ofTable: item.table).map { (kind: $0, id: item.id) } }
        if !response.rejected.isEmpty {
            ErrorReport.log("The server refused writes", detail: response.rejected.map { "\($0.table) \($0.id): \($0.reason)" }.joined(separator: "\n"))
            await rejected(refused)
        }
        try await batch.complete()
    }

    /// A queued entry as a row write. `values` stay PowerSync's columns as the server reads them: snake_case names,
    /// JSON columns as JSON text, numbers as numbers. Only the server writes `access`, so an entry for it, or for any
    /// table the client does not write, is dropped: thrown, it would stall every upload behind it.
    private static func rowWrite(_ entry: CrudEntry, databaseID: String) throws -> RowWrite? {
        guard let kind = Rows.kind(ofTable: entry.table) else {
            ErrorReport.log("Dropped a local write to a table the server owns", detail: "\(entry.op) \(entry.table) \(entry.id)")
            return nil
        }
        let op: RowWrite.Op = switch entry.op {
        case .put: .put
        case .patch: .patch
        case .delete: .delete
        }
        var values = try entry.opDataTyped.map { data -> [String: JSONValue] in
            guard case let .object(fields) = try JSONValue.encoded(data) else { return [:] }
            return fields
        } ?? [:]
        // PowerSync leaves null columns out of a put; the server reads a put as the whole row, as sync-smoke sends it.
        if op == .put, let layout = syncedValues[entry.table]?.layout {
            for column in layout.columns where column.name != "id" && values[column.name] == nil {
                values[column.name] = .null
            }
        }
        return RowWrite(
            op: op, kind: kind, id: entry.id, values: op == .delete ? nil : values, opId: "\(databaseID):\(entry.clientId)"
        )
    }

    private static func wire(_ write: RowWrite) -> JSONValue {
        var fields: [String: JSONValue] = [
            "op": .string(write.op.rawValue), "table": .string(Rows.table(of: write.kind)), "id": .string(write.id),
        ]
        if let values = write.values { fields["values"] = .object(values) }
        if let opId = write.opId { fields["opId"] = .string(opId) }
        return .object(fields)
    }
}
