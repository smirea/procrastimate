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

/// Device-local sync state. A device without it is unpaired and keeps no outbox. `clock` is the last clock the device
/// issued or saw, and `timeZone` the zone it last wrote to the synced settings, so it writes again only after it moves.
public struct SyncSection: Hashable, Codable, Sendable {
    public var deviceId: String
    public var cursor: Int
    public var outbox: [SyncOp]
    public var clock: String
    public var timeZone: String

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        deviceId = try c.decode(String.self, forKey: .deviceId)
        cursor = try c.decode(Int.self, forKey: .cursor)
        outbox = try c.decode([SyncOp].self, forKey: .outbox)
        clock = try c.decode(String.self, forKey: .clock)
        timeZone = try c.decode(String.self, forKey: .timeZone)
        guard cursor >= 0 else {
            throw DecodingError.dataCorruptedError(forKey: .cursor, in: c, debugDescription: "Negative cursor")
        }
        guard isHlc(clock) else {
            throw DecodingError.dataCorruptedError(forKey: .clock, in: c, debugDescription: "Invalid HLC")
        }
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
        let loaded = try c.decode([Lenient<TaskItem>].self, forKey: .tasks).compactMap { $0.value?.validated() }
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

extension TaskItem {
    /// The web schema's value rules on top of the JSON shape: well-formed dates and times, positive whole intervals,
    /// weekdays 0 to 6, and reminder offsets of zero or more. A weekday set is normalized like `weeklyOn`.
    func validated() -> TaskItem? {
        guard let due = validated(due), let recurrence = validated(recurrence) else { return nil }
        for reminder in reminders {
            switch reminder {
            case let .before(minutes) where minutes < 0: return nil
            case let .at(date, time) where !Self.isDateKey(date) || !Self.isTimeOfDay(time): return nil
            case .before, .at: continue
            }
        }
        var task = self
        task.due = due
        task.recurrence = recurrence
        return task
    }

    /// Nil when invalid; `.some(nil)` when there is no due date.
    private func validated(_ due: Due?) -> Due?? {
        guard let due else { return .some(nil) }
        guard Self.isDateKey(due.date), due.time.map(Self.isTimeOfDay) ?? true else { return nil }
        return due
    }

    private func validated(_ recurrence: Recurrence?) -> Recurrence?? {
        guard let recurrence else { return .some(nil) }
        guard recurrence.interval > 0 else { return nil }
        guard recurrence.unit == .week else { return recurrence }
        if let days = recurrence.days, days.isEmpty || days.contains(where: { !(0...6).contains($0) }) { return nil }
        return Dates.weeklyOn(recurrence.interval, recurrence.days ?? [])
    }

    static func isDateKey(_ value: String) -> Bool { matches(value, "dddd-dd-dd") }
    static func isTimeOfDay(_ value: String) -> Bool { matches(value, "dd:dd") }

    /// `d` is an ASCII digit and any other character must match itself.
    private static func matches(_ value: String, _ pattern: String) -> Bool {
        let scalars = Array(value.unicodeScalars)
        let expected = Array(pattern.unicodeScalars)
        guard scalars.count == expected.count else { return false }
        return zip(scalars, expected).allSatisfy { s, p in p == "d" ? ("0"..."9").contains(s) : s == p }
    }
}
