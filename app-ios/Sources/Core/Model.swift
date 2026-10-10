import Foundation

/// Local calendar date, `YYYY-MM-DD`.
public typealias DateKey = String
/// Local wall-clock time, `HH:mm`.
public typealias TimeOfDay = String
/// Sunday is 0, as in JavaScript's `Date#getDay`.
public typealias Weekday = Int

/// Todoist priorities: 1 is the most urgent, 4 is the unmarked default.
public enum Priority: Int, Codable, Sendable, CaseIterable, Comparable {
    case p1 = 1, p2, p3, p4

    public static let `default` = Priority.p4

    public static func < (a: Priority, b: Priority) -> Bool { a.rawValue < b.rawValue }
}

public struct Due: Hashable, Codable, Sendable {
    public var date: DateKey
    public var time: TimeOfDay?

    public init(date: DateKey, time: TimeOfDay?) {
        self.date = date
        self.time = time
    }

    private enum CodingKeys: String, CodingKey { case date, time }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        date = try c.decode(DateKey.self, forKey: .date)
        time = try c.decode(TimeOfDay?.self, forKey: .time)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(date, forKey: .date)
        try c.encode(time, forKey: .time)
    }
}

public enum Reminder: Hashable, Codable, Sendable {
    case before(minutes: Int)
    case at(date: DateKey, time: TimeOfDay)

    private enum CodingKeys: String, CodingKey { case kind, minutes, date, time }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        switch try c.decode(String.self, forKey: .kind) {
        case "before": self = .before(minutes: try c.decode(Int.self, forKey: .minutes))
        case "at": self = .at(date: try c.decode(DateKey.self, forKey: .date), time: try c.decode(TimeOfDay.self, forKey: .time))
        case let kind:
            throw DecodingError.dataCorruptedError(forKey: .kind, in: c, debugDescription: "Unknown reminder kind \(kind)")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case let .before(minutes):
            try c.encode("before", forKey: .kind)
            try c.encode(minutes, forKey: .minutes)
        case let .at(date, time):
            try c.encode("at", forKey: .kind)
            try c.encode(date, forKey: .date)
            try c.encode(time, forKey: .time)
        }
    }
}

/// `weekday` counts Monday to Friday only.
public enum RecurrenceUnit: String, Codable, Sendable, CaseIterable {
    case day, weekday, week, month, year
}

/// Repeats every `interval` units, counted from the due date. A weekly repeat keeps the due date's weekday, or, with
/// `days`, repeats on each listed weekday of every `interval`-th week. `days` holds two or more weekdays sorted Monday
/// first and only ever appears on a weekly repeat. Build it with `Dates.weeklyOn`.
public struct Recurrence: Hashable, Codable, Sendable {
    public var interval: Int
    public var unit: RecurrenceUnit
    public var days: [Weekday]?

    public init(interval: Int, unit: RecurrenceUnit, days: [Weekday]? = nil) {
        self.interval = interval
        self.unit = unit
        self.days = unit == .week ? days : nil
    }

    private enum CodingKeys: String, CodingKey { case interval, unit, days }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        interval = try c.decode(Int.self, forKey: .interval)
        unit = try c.decode(RecurrenceUnit.self, forKey: .unit)
        days = unit == .week ? try c.decodeAbsentOr([Weekday].self, forKey: .days) : nil
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(interval, forKey: .interval)
        try c.encode(unit, forKey: .unit)
        try c.encodeIfPresent(days, forKey: .days)
    }
}

/// A task. Named `TaskItem` because `Task` is Swift concurrency's.
public struct TaskItem: Hashable, Codable, Sendable, Identifiable {
    public var id: String
    /// The task this one is a subtask of. A subtask shares its root task's project.
    public var parentId: String?
    /// Position among its siblings, ascending.
    public var order: Double
    public var title: String
    public var notes: String
    public var projectId: String?
    public var labelIds: [String]
    public var due: Due?
    public var recurrence: Recurrence?
    public var priority: Priority
    public var reminders: [Reminder]
    /// Epoch milliseconds.
    public var createdAt: Int
    /// Epoch milliseconds.
    public var completedAt: Int?
    /// Where an imported task came from, such as `todoist:task:…`, so importing the same backup again skips it.
    public var sourceKey: String?

    public init(
        id: String,
        parentId: String? = nil,
        order: Double = 0,
        title: String,
        notes: String = "",
        projectId: String? = nil,
        labelIds: [String] = [],
        due: Due? = nil,
        recurrence: Recurrence? = nil,
        priority: Priority = .default,
        reminders: [Reminder] = [],
        createdAt: Int,
        completedAt: Int? = nil,
        sourceKey: String? = nil
    ) {
        self.id = id
        self.parentId = parentId
        self.order = order
        self.title = title
        self.notes = notes
        self.projectId = projectId
        self.labelIds = labelIds
        self.due = due
        self.recurrence = recurrence
        self.priority = priority
        self.reminders = reminders
        self.createdAt = createdAt
        self.completedAt = completedAt
        self.sourceKey = sourceKey
    }

    private enum CodingKeys: String, CodingKey {
        case id, parentId, order, title, notes, projectId, labelIds, due, recurrence, priority, reminders, createdAt
        case completedAt, sourceKey
    }

    /// Fields added after launch (`parentId`, `order`, `labelIds`, `recurrence`) default when missing, as on the web.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        parentId = try c.decodeAbsentOr(String?.self, forKey: .parentId) ?? nil
        order = try c.decodeAbsentOr(Double.self, forKey: .order) ?? 0
        title = try c.decode(String.self, forKey: .title)
        notes = try c.decode(String.self, forKey: .notes)
        projectId = try c.decode(String?.self, forKey: .projectId)
        labelIds = try c.decodeAbsentOr([String].self, forKey: .labelIds) ?? []
        due = try c.decode(Due?.self, forKey: .due)
        recurrence = try c.decodeAbsentOr(Recurrence?.self, forKey: .recurrence) ?? nil
        priority = try c.decode(Priority.self, forKey: .priority)
        reminders = try c.decode([Reminder].self, forKey: .reminders)
        createdAt = try c.decode(Int.self, forKey: .createdAt)
        completedAt = try c.decode(Int?.self, forKey: .completedAt)
        sourceKey = try c.decodeAbsentOr(String.self, forKey: .sourceKey)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(parentId, forKey: .parentId)
        try c.encode(order, forKey: .order)
        try c.encode(title, forKey: .title)
        try c.encode(notes, forKey: .notes)
        try c.encode(projectId, forKey: .projectId)
        try c.encode(labelIds, forKey: .labelIds)
        try c.encode(due, forKey: .due)
        try c.encode(recurrence, forKey: .recurrence)
        try c.encode(priority, forKey: .priority)
        try c.encode(reminders, forKey: .reminders)
        try c.encode(createdAt, forKey: .createdAt)
        try c.encode(completedAt, forKey: .completedAt)
        try c.encodeIfPresent(sourceKey, forKey: .sourceKey)
    }
}

public struct Project: Hashable, Codable, Sendable, Identifiable {
    public var id: String
    public var name: String
    public var createdAt: Int
    public var sourceKey: String?

    public init(id: String, name: String, createdAt: Int, sourceKey: String? = nil) {
        self.id = id
        self.name = name
        self.createdAt = createdAt
        self.sourceKey = sourceKey
    }

    private enum CodingKeys: String, CodingKey { case id, name, createdAt, sourceKey }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        createdAt = try c.decode(Int.self, forKey: .createdAt)
        sourceKey = try c.decodeAbsentOr(String.self, forKey: .sourceKey)
    }
}

/// A tag that crosses projects. A task carries any number of them.
public struct Label: Hashable, Codable, Sendable, Identifiable {
    public var id: String
    public var name: String
    public var createdAt: Int

    public init(id: String, name: String, createdAt: Int) {
        self.id = id
        self.name = name
        self.createdAt = createdAt
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
