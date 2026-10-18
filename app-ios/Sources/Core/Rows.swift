import Foundation

public typealias EntityKind = API.EntityKind

/// One row to write to a database: a new entity is a `put` with every field, a changed one a `patch` with only the
/// fields that changed, and a removed one a `delete`. `values` are the domain's camelCase fields as JSON.
public struct RowWrite: Hashable, Sendable {
    public enum Op: String, Hashable, Sendable { case put, patch, delete }

    public var op: Op
    public var kind: EntityKind
    public var id: String
    public var values: [String: JSONValue]?

    public init(op: Op, kind: EntityKind, id: String, values: [String: JSONValue]? = nil) {
        self.op = op
        self.kind = kind
        self.id = id
        self.values = values
    }
}

/// The port of `shared/rows.ts`: the bridge between the in-memory store and the local database. Every store rule stays
/// a function from one snapshot to the next, and `rowWrites` turns the before and after into the rows to write.
public enum Rows {
    /// Projects, sections, and labels come before the tasks that point at them, and tasks before their comments.
    public static let kinds: [EntityKind] = [.project, .section, .label, .task, .comment, .read, .settings]

    public static let settingsID = "settings"

    /// Each kind's table, the name PowerSync and both databases use.
    public static func table(of kind: EntityKind) -> String {
        switch kind {
        case .task: "tasks"
        case .project: "projects"
        case .section: "sections"
        case .label: "labels"
        case .comment: "comments"
        case .read: "reads"
        case .settings: "settings"
        }
    }

    public static func kind(ofTable table: String) -> EntityKind? { kinds.first { self.table(of: $0) == table } }

    public static func rowWrites(_ before: Snapshot, _ after: Snapshot) -> [RowWrite] {
        kinds.flatMap { kind -> [RowWrite] in
            switch kind {
            case .project: diff(kind, before.projects, after.projects)
            case .section: diff(kind, before.sections, after.sections)
            case .label: diff(kind, before.labels, after.labels)
            case .task: diff(kind, before.tasks, after.tasks)
            case .comment: diff(kind, before.comments, after.comments)
            case .read: diff(kind, before.reads, after.reads)
            case .settings:
                before.settings == after.settings ? [] : patch(kind, settingsID, fields(before.settings), fields(after.settings))
            }
        }
    }

    /// Unchanged entities compare equal as values, so only the ones a command touched are encoded.
    private static func diff<T: Encodable & Identifiable & Equatable>(_ kind: EntityKind, _ before: [T], _ after: [T]) -> [RowWrite]
    where T.ID == String {
        let previous = Dictionary(before.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        var writes: [RowWrite] = []
        for entity in after {
            guard let old = previous[entity.id] else {
                writes.append(RowWrite(op: .put, kind: kind, id: entity.id, values: fields(entity)))
                continue
            }
            if old != entity { writes += patch(kind, entity.id, fields(old), fields(entity)) }
        }
        let kept = Set(after.map(\.id))
        for entity in before where !kept.contains(entity.id) {
            writes.append(RowWrite(op: .delete, kind: kind, id: entity.id))
        }
        return writes
    }

    private static func patch(_ kind: EntityKind, _ id: String, _ prior: [String: JSONValue], _ next: [String: JSONValue]) -> [RowWrite] {
        let changed = next.filter { name, value in prior[name] ?? .null != value }
        return changed.isEmpty ? [] : [RowWrite(op: .patch, kind: kind, id: id, values: changed)]
    }

    /// Every synced field of an entity without its id, with an absent `sourceKey` as `null`.
    static func fields(_ entity: some Encodable) -> [String: JSONValue] {
        guard case var .object(fields) = JSONValue.encoding(entity) else { return [:] }
        fields["id"] = nil
        if entity is TaskItem || entity is Project || entity is ProjectSection, fields["sourceKey"] == nil {
            fields["sourceKey"] = .null
        }
        return fields
    }

    /// Folds writes to one row into one: a patch folds into the write before it, keeping that write's place, later
    /// fields winning. A put or a delete replaces what came before and moves to its own place, so a row deleted and
    /// created again still follows the rows it points at. A patch after a delete changes nothing.
    public static func coalesce(_ writes: [RowWrite]) -> [RowWrite] {
        var out: [RowWrite?] = []
        var at: [String: Int] = [:]
        for write in writes {
            let key = "\(write.kind.rawValue):\(write.id)"
            let index = at[key]
            if let index, let prior = out[index], write.op == .patch {
                if prior.op != .delete {
                    out[index]?.values = (prior.values ?? [:]).merging(write.values ?? [:]) { _, later in later }
                }
                continue
            }
            if let index { out[index] = nil }
            out.append(write)
            at[key] = out.count - 1
        }
        return out.compactMap(\.self)
    }

    /// The notice for writes the server refused, named by what `snapshot` shows before the server's value replaces it.
    public static func rejectionNotice(_ snapshot: Snapshot, _ rejected: [(kind: EntityKind, id: String)]) -> String? {
        var seen = Set<String>()
        let rows = rejected.filter { seen.insert("\($0.kind.rawValue):\($0.id)").inserted }
        guard let first = rows.first else { return nil }
        if rows.count > 1 { return "Couldn’t save changes to \(rows.count) items" }
        let name: String? = switch first.kind {
        case .task: snapshot.tasks.first { $0.id == first.id }?.title
        case .project: snapshot.projects.first { $0.id == first.id }?.name
        case .section: snapshot.sections.first { $0.id == first.id }?.name
        case .label: snapshot.labels.first { $0.id == first.id }?.name
        default: nil
        }
        return name.map { "Couldn’t save a change to “\($0)”" } ?? "Couldn’t save a change"
    }
}

extension JSONValue {
    /// A Codable value as JSON, or null when it does not encode.
    public static func encoding(_ value: some Encodable) -> JSONValue {
        guard let data = try? JSONEncoder().encode(value),
              let json = try? JSONDecoder().decode(JSONValue.self, from: data) else { return .null }
        return json
    }

    public func decoded<T: Decodable>(as _: T.Type = T.self) throws -> T {
        try JSONDecoder().decode(T.self, from: JSONEncoder().encode(self))
    }
}
