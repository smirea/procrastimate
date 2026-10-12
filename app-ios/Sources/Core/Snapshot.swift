import Foundation

/// A change waiting to sync, as `docs/decisions/sync.md` describes it. `fields` holds the changed fields' new values.
public struct SyncOp: Hashable, Codable, Sendable {
    public enum Kind: String, Codable, Sendable {
        case task, project, label, settings
    }

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

/// Device-local sync state. Every document has one. `clock` is the last clock the device issued or saw, and
/// `timeZone` the zone it last wrote to the synced settings. `epoch` is the wipe generation it last applied.
/// `reset` stays set until the server has wiped task data for a local delete-all.
public struct SyncSection: Hashable, Codable, Sendable {
    public var deviceId: String
    public var cursor: Int
    public var outbox: [SyncOp]
    public var clock: String
    public var timeZone: String
    public var epoch: Int
    public var reset: Bool

    public init(
        deviceId: String,
        cursor: Int,
        outbox: [SyncOp],
        clock: String,
        timeZone: String,
        epoch: Int = 0,
        reset: Bool = false
    ) {
        self.deviceId = deviceId
        self.cursor = cursor
        self.outbox = outbox
        self.clock = clock
        self.timeZone = timeZone
        self.epoch = epoch
        self.reset = reset
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        deviceId = try c.decode(String.self, forKey: .deviceId)
        cursor = try c.decode(Int.self, forKey: .cursor)
        outbox = try c.decode([SyncOp].self, forKey: .outbox)
        clock = try c.decode(String.self, forKey: .clock)
        timeZone = try c.decode(String.self, forKey: .timeZone)
        epoch = try c.decodeIfPresent(Int.self, forKey: .epoch) ?? 0
        reset = try c.decodeIfPresent(Bool.self, forKey: .reset) ?? false
        guard cursor >= 0, epoch >= 0 else {
            throw DecodingError.dataCorruptedError(forKey: .cursor, in: c, debugDescription: "Negative cursor or epoch")
        }
        guard isHlc(clock) else {
            throw DecodingError.dataCorruptedError(forKey: .clock, in: c, debugDescription: "Invalid HLC")
        }
    }

    private enum CodingKeys: String, CodingKey {
        case deviceId, cursor, outbox, clock, timeZone, epoch, reset
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(deviceId, forKey: .deviceId)
        try c.encode(cursor, forKey: .cursor)
        try c.encode(outbox, forKey: .outbox)
        try c.encode(clock, forKey: .clock)
        try c.encode(timeZone, forKey: .timeZone)
        try c.encode(epoch, forKey: .epoch)
        try c.encode(reset, forKey: .reset)
    }
}

/// The one stored document: the web's `procrastimate` localStorage value and the iOS app's JSON file. Loading drops an
/// invalid task on its own, defaults fields added later, and discards an invalid document, with no migrations.
public struct Snapshot: Hashable, Codable, Sendable {
    public var tasks: [TaskItem]
    public var projects: [Project]
    public var labels: [Label]
    /// Epoch milliseconds of the last check for due reminders.
    public var remindersCheckedAt: Int
    public var sync: SyncSection?

    public init(
        tasks: [TaskItem] = [],
        projects: [Project] = [],
        labels: [Label] = [],
        remindersCheckedAt: Int,
        sync: SyncSection? = nil
    ) {
        self.tasks = tasks
        self.projects = projects
        self.labels = labels
        self.remindersCheckedAt = remindersCheckedAt
        self.sync = sync
    }

    public static func empty(now: Int) -> Snapshot { Snapshot(remindersCheckedAt: now) }

    public var data: StoreData {
        get { StoreData(tasks: tasks, projects: projects, labels: labels) }
        set {
            tasks = newValue.tasks
            projects = newValue.projects
            labels = newValue.labels
        }
    }

    /// Reads a stored document, or starts empty when it is invalid.
    public static func load(_ json: Data, now: Int) -> Snapshot {
        (try? JSONDecoder().decode(Snapshot.self, from: json)) ?? .empty(now: now)
    }

    /// The stored JSON, with keys sorted so a write is stable.
    public func encoded() throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(self)
    }

    private enum CodingKeys: String, CodingKey { case tasks, projects, labels, remindersCheckedAt, sync }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let loaded = try c.decode([Lenient<StoredTask>].self, forKey: .tasks).compactMap { $0.value?.task }
        tasks = StoreRules.sortTasks(Subtasks.detachOrphans(loaded))
        projects = try c.decode([Project].self, forKey: .projects)
        labels = try c.decodeAbsentOr([Label].self, forKey: .labels) ?? []
        remindersCheckedAt = try c.decode(Int.self, forKey: .remindersCheckedAt)
        sync = try c.decodeAbsentOr(SyncSection.self, forKey: .sync)
    }
}

/// Decodes one element without failing the array around it.
private struct Lenient<T: Decodable>: Decodable {
    let value: T?

    init(from decoder: Decoder) throws {
        value = try? T(from: decoder)
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
        ("parentId", .null), ("order", .number(0)), ("labelIds", .array([])), ("recurrence", .null),
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

extension KeyedDecodingContainer {
    /// Decodes an optional field the way the web's schema does: a missing key is `nil`, but an explicit `null` for a
    /// field that is not itself nullable is an error, unlike `decodeIfPresent`.
    func decodeAbsentOr<T: Decodable>(_ type: T.Type, forKey key: Key) throws -> T? {
        guard contains(key) else { return nil }
        return try decode(T.self, forKey: key)
    }
}
