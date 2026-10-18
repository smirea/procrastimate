import Core
import Foundation
import GRDB

/// A synced table's columns in Core's terms, generated from the server schema into `Generated/SyncedTables.swift`:
/// which key of the Core type each column holds, and how PowerSync stores it.
struct RowLayout: Sendable {
    enum Kind: Sendable { case text, integer, real, json }

    struct Column: Sendable {
        let key: String
        let name: String
        let kind: Kind
        /// False for a key the Core type leaves out when it is null, like `sourceKey`.
        let required: Bool
    }

    let table: String
    let columns: [Column]
}

protocol SyncedValue: Codable, Hashable, Sendable {
    static var layout: RowLayout { get }
}

struct RowCodingError: Error, CustomStringConvertible {
    let description: String
}

/// One row of a synced table: its id, the `user_id` of the space it lives in (none for `access`), and the Core value it
/// holds. GRDB reads and writes it as a record over PowerSync's views. JSON columns go through JSON text, so a row
/// decodes with the same rules as the API's JSON.
struct SyncedRow<Value: SyncedValue>: FetchableRecord, PersistableRecord, Sendable {
    var id: String
    var owner: String?
    var value: Value

    static var databaseTableName: String { Value.layout.table }

    init(id: String, owner: String?, value: Value) {
        self.id = id
        self.owner = owner
        self.value = value
    }

    init(row: Row) throws {
        var fields: [String: JSONValue] = [:]
        var owner: String?
        for column in Value.layout.columns {
            let stored: DatabaseValue = row[column.name]
            if column.key == "userId" {
                owner = String.fromDatabaseValue(stored)
                continue
            }
            let json = try Self.json(stored, column)
            if json == .null, !column.required { continue }
            fields[column.key] = json
        }
        guard case let .string(id) = fields["id"] else { throw RowCodingError(description: "\(Value.layout.table) row without an id") }
        self.id = id
        self.owner = owner
        value = try JSONValue.object(fields).decoded()
    }

    func encode(to container: inout PersistenceContainer) throws {
        guard case let .object(fields) = try JSONValue.encoded(value) else {
            throw RowCodingError(description: "\(Value.layout.table) value is not an object")
        }
        for column in Value.layout.columns {
            switch column.key {
            case "id": container[column.name] = id
            case "userId": container[column.name] = owner
            default: container[column.name] = try Self.databaseValue(fields[column.key] ?? .null, column)
            }
        }
    }

    var owned: Owned<Value>? { owner.map { Owned(owner: $0, value: value) } }

    private static func json(_ stored: DatabaseValue, _ column: RowLayout.Column) throws -> JSONValue {
        switch (stored.storage, column.kind) {
        case (.null, _): return .null
        case let (.string(text), .json): return try JSONDecoder().decode(JSONValue.self, from: Data(text.utf8))
        case let (.string(text), .text): return .string(text)
        case let (.string(text), .integer), let (.string(text), .real):
            guard let number = Double(text) else { break }
            return .number(number)
        case let (.int64(number), .integer), let (.int64(number), .real): return .number(Double(number))
        case let (.double(number), .integer), let (.double(number), .real): return .number(number)
        default: break
        }
        throw RowCodingError(description: "\(Value.layout.table).\(column.name) holds \(stored)")
    }

    private static func databaseValue(_ json: JSONValue, _ column: RowLayout.Column) throws -> DatabaseValue {
        switch (json, column.kind) {
        case (.null, _): return .null
        case (_, .json): return String(decoding: try JSONValue.compact.encode(json), as: UTF8.self).databaseValue
        case let (.string(text), .text): return text.databaseValue
        case let (.number(number), .integer): return Int64(number).databaseValue
        case let (.number(number), .real): return number.databaseValue
        default: throw RowCodingError(description: "\(Value.layout.table).\(column.name) cannot hold \(json)")
        }
    }
}

extension JSONValue {
    static var compact: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return encoder
    }

}
