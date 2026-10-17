import Foundation

public struct SyncOp: Hashable, Codable, Sendable {
    public typealias Kind = API.EntityKind

    public var opId: String
    public var hlc: String
    public var kind: Kind
    public var id: String
    public var fields: [String: JSONValue]

    public init(opId: String, hlc: String, kind: Kind, id: String, fields: [String: JSONValue]) {
        self.opId = opId
        self.hlc = hlc
        self.kind = kind
        self.id = id
        self.fields = fields
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        opId = try c.decode(String.self, forKey: .opId)
        hlc = try c.decode(String.self, forKey: .hlc)
        kind = try c.decode(Kind.self, forKey: .kind)
        id = try c.decode(String.self, forKey: .id)
        fields = try c.decode([String: JSONValue].self, forKey: .fields)
        guard isHlc(hlc) else {
            throw DecodingError.dataCorruptedError(forKey: .hlc, in: c, debugDescription: "Invalid HLC")
        }
    }

    private enum CodingKeys: String, CodingKey { case opId, hlc, kind, id, fields }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(opId, forKey: .opId)
        try c.encode(hlc, forKey: .hlc)
        try c.encode(kind, forKey: .kind)
        try c.encode(id, forKey: .id)
        try c.encode(fields, forKey: .fields)
    }
}

/// `<wall ms>:<counter>:<node>` with a wall time and counter no larger than `Number.MAX_SAFE_INTEGER`.
func isHlc(_ value: String) -> Bool {
    let parts = value.split(separator: ":", maxSplits: 2, omittingEmptySubsequences: false)
    guard parts.count == 3, !parts[2].isEmpty else { return false }
    return parts[..<2].allSatisfy { part in
        !part.isEmpty && part.allSatisfy(\.isASCIIDigit) && (Double(part).map { $0 <= 9_007_199_254_740_991 } ?? false)
    }
}

private extension Character {
    var isASCIIDigit: Bool { isASCII && isNumber }
}

/// Device-local sync state. Every document has one. `clock` is the last clock the device issued or saw,
/// `timeZone` the zone it last wrote to the synced settings, and `dictation` the choice last applied.
/// `epoch` is the wipe generation it last applied.
/// `reset` stays set until the server has wiped task data for a local delete-all.
public typealias SyncSection = API.SyncSection

/// The one stored document: the web's `procrastimate` localStorage value and the iOS app's JSON file. Loading drops an
/// invalid task on its own, defaults fields added later, and discards an invalid document, with no migrations.
public typealias Snapshot = API.Snapshot

extension API.Snapshot {
    public static func empty(now: Int) -> Snapshot { Snapshot(remindersCheckedAt: now) }

    public var data: StoreData {
        get { StoreData(tasks: tasks, projects: projects, sections: sections, labels: labels, comments: comments, reads: reads) }
        set {
            tasks = newValue.tasks
            projects = newValue.projects
            sections = newValue.sections
            labels = newValue.labels
            comments = newValue.comments
            reads = newValue.reads
        }
    }

    /// Reads a stored document, or starts empty when it is invalid.
    public static func load(_ json: Data, now: Int) -> Snapshot {
        (try? JSONDecoder.validating().decode(Snapshot.self, from: json)) ?? .empty(now: now)
    }

    /// The stored JSON, with keys sorted so a write is stable.
    public func encoded() throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(self)
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let loaded = try c.decode([Lenient<StoredTask>].self, forKey: .tasks).compactMap { $0.value?.task }
        tasks = StoreRules.sortTasks(Subtasks.detachOrphans(loaded))
        projects = try c.decode([StoredProject].self, forKey: .projects).map(\.project)
        sections = try c.decodeAbsent([ProjectSection].self, forKey: .sections) ?? []
        labels = try c.decodeAbsent([StoredLabel].self, forKey: .labels)?.map(\.label) ?? []
        comments = try c.decodeAbsent([Comment].self, forKey: .comments) ?? []
        reads = try c.decodeAbsent([CommentRead].self, forKey: .reads) ?? []
        remindersCheckedAt = try c.decode(Int.self, forKey: .remindersCheckedAt)
        sync = try c.decodeAbsent(SyncSection.self, forKey: .sync)
        // A shared space that fails is dropped on its own; its next sync starts it over.
        spaces = (try c.decodeAbsent([String: Lenient<SpaceSection>].self, forKey: .spaces) ?? [:])
            .compactMapValues(\.value)
        people = try c.decodeAbsent([Person].self, forKey: .people) ?? []
    }
}

/// A space someone shared with this user, kept apart from the user's own data and synced on its own. The document's
/// sync clock serves every space.
public typealias SpaceSection = API.SpaceSection

extension API.SpaceSection {
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        owner = try c.decode(Person.self, forKey: .owner)
        cursor = try c.decode(Int.self, forKey: .cursor)
        try check(cursor >= 0, CodingKeys.cursor, in: c, "cursor >= 0")
        outbox = try c.decode([SyncOp].self, forKey: .outbox)
        epoch = try c.decodeAbsent(Int.self, forKey: .epoch) ?? 0
        try check(epoch >= 0, CodingKeys.epoch, in: c, "epoch >= 0")
        scope = try c.decodeAbsent(String.self, forKey: .scope) ?? ""
        readOnly = try c.decodeAbsent([String].self, forKey: .readOnly) ?? []
        targets = try c.decodeAbsent([API.ShareTarget].self, forKey: .targets) ?? []
        let loaded = try c.decode([Lenient<StoredTask>].self, forKey: .tasks).compactMap { $0.value?.task }
        tasks = StoreRules.sortTasks(Subtasks.detachOrphans(loaded))
        projects = try c.decodeAbsent([StoredProject].self, forKey: .projects)?.map(\.project) ?? []
        sections = try c.decodeAbsent([ProjectSection].self, forKey: .sections) ?? []
        labels = try c.decodeAbsent([StoredLabel].self, forKey: .labels)?.map(\.label) ?? []
        comments = try c.decodeAbsent([Comment].self, forKey: .comments) ?? []
    }
}

/// Decodes one element without failing the array around it.
private struct Lenient<T: Decodable>: Decodable {
    let value: T?

    init(from decoder: Decoder) throws {
        value = try? T(from: decoder)
    }
}

/// A project stored before ordering sits at 0, so it keeps its place by creation.
private struct StoredProject: Decodable {
    let project: Project

    private enum CodingKeys: String, CodingKey { case id, name, order, createdAt, sourceKey }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        project = Project(
            id: try c.decode(String.self, forKey: .id),
            name: try c.decode(String.self, forKey: .name),
            order: try c.decodeAbsent(Double.self, forKey: .order) ?? 0,
            createdAt: try c.decode(Int.self, forKey: .createdAt),
            sourceKey: try c.decodeAbsent(String.self, forKey: .sourceKey)
        )
    }
}

/// A label stored before colors takes its name's default color, as the server gives it, and one before places is none.
private struct StoredLabel: Decodable {
    let label: Label

    private enum CodingKeys: String, CodingKey { case id, name, color, place, createdAt }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let name = try c.decode(String.self, forKey: .name)
        label = Label(
            id: try c.decode(String.self, forKey: .id),
            name: name,
            color: try c.decodeAbsent(LabelColor.self, forKey: .color) ?? LabelColors.defaultLabelColor(name),
            place: try c.decodeAbsent(SavedPlace?.self, forKey: .place) ?? nil,
            createdAt: try c.decode(Int.self, forKey: .createdAt)
        )
    }
}

/**
 The stored document's loading rules on top of the task type, as `shared/snapshot.ts` adds them: fields added after
 launch default when missing, and a weekly repeat is normalized like `weeklyOn`, so one stored day is a plain weekly
 repeat. The validating decoder checks every other rule, so a task that breaks one is dropped on its own.
 */
private struct StoredTask: Decodable {
    let task: TaskItem

    private static let added: [(String, JSONValue)] = [
        ("parentId", .null), ("order", .number(0)), ("sectionId", .null), ("labelIds", .array([])), ("recurrence", .null),
        ("location", .null), ("event", .null), ("images", .array([])), ("createdBy", .null), ("completedBy", .null),
        ("lastCompletedAt", .null),
    ]

    init(from decoder: Decoder) throws {
        guard case var .object(fields) = try JSONValue(from: decoder) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Not a task"))
        }
        for (key, value) in Self.added where fields[key] == nil { fields[key] = value }
        if case var .object(recurrence) = fields["recurrence"], recurrence["unit"] == .string("week"),
           case let .array(days) = recurrence["days"], days.count == 1,
           case let .number(day) = days[0], (0...6).contains(day), day == day.rounded() {
            recurrence["days"] = nil
            fields["recurrence"] = .object(recurrence)
        }
        var task = try JSONDecoder.validating().decode(TaskItem.self, from: JSONEncoder().encode(JSONValue.object(fields)))
        if let recurrence = task.recurrence, recurrence.unit == .week {
            task.recurrence = Dates.weeklyOn(recurrence.interval, recurrence.days ?? [])
        }
        self.task = task
    }
}
