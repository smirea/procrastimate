import Core
import Foundation
import Testing

/// Checks the Swift port against `shared/vectors/*.json`, which `bun run vectors` records from the TypeScript tests.
/// Every case must produce the recorded output, and a module or function without a Swift handler fails, so a TS
/// change that alters behavior turns this red until the port matches.
@Suite struct VectorTests {
    @Test(arguments: VectorFile.all)
    func matchesTypeScript(_ file: VectorFile) throws {
        let zone = try #require(TimeZone(identifier: file.timeZone))
        let handler = try #require(handlers[file.module], "No Swift port for shared/\(file.module).ts")
        for vector in file.cases {
            let args = Args(values: vector.input, zone: zone)
            let output = try handler(vector.fn, args)
            if output != vector.output {
                Issue.record("""
                \(file.module).\(vector.fn) in "\(vector.test)"
                  Swift: \(try text(output))
                  TS:    \(try text(vector.output))
                """)
            }
        }
    }

    @Test func everyPortedModuleHasVectors() {
        #expect(Set(VectorFile.all.map(\.module)).isSuperset(of: handlers.keys))
    }
}

struct VectorFile: Decodable, Sendable, CustomTestStringConvertible {
    struct Case: Decodable, Sendable {
        let fn: String
        let test: String
        let input: [JSONValue]
        let output: JSONValue
    }

    let module: String
    let timeZone: String
    let cases: [Case]

    var testDescription: String { module }

    static let directory = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()
        .appending(path: "../../../shared/vectors")
        .standardized

    static let all: [VectorFile] = {
        let names = (try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? []
        return names.filter { $0.hasSuffix(".json") }.sorted().map { name in
            let data = try! Data(contentsOf: directory.appending(path: name))
            return try! JSONDecoder().decode(VectorFile.self, from: data)
        }
    }()
}

struct VectorError: Error, CustomStringConvertible {
    let description: String
}

/// A case's recorded arguments, decoded on demand into the types the Swift function takes.
struct Args {
    let values: [JSONValue]
    let zone: TimeZone

    func callAsFunction<T: Decodable>(_ index: Int, as type: T.Type = T.self) throws -> T {
        try decode(index < values.count ? values[index] : .null)
    }

    func date(_ index: Int) throws -> Date { Date(epochMilliseconds: try self(index)) }
}

private let encoder: JSONEncoder = {
    let encoder = JSONEncoder()
    encoder.outputFormatting = .sortedKeys
    return encoder
}()

func decode<T: Decodable>(_ value: JSONValue) throws -> T {
    try JSONDecoder().decode(T.self, from: try encoder.encode(value))
}

func json(_ value: some Encodable) throws -> JSONValue {
    try JSONDecoder().decode(JSONValue.self, from: try encoder.encode(value))
}

func text(_ value: JSONValue) throws -> String { String(decoding: try encoder.encode(value), as: UTF8.self) }

func object(_ fields: [String: JSONValue]) -> JSONValue { .object(fields) }

func unknown(_ fn: String) -> VectorError { VectorError(description: "No Swift handler for \(fn)") }

typealias Handler = @Sendable (String, Args) throws -> JSONValue

let handlers: [String: Handler] = [
    "task": taskVector,
    "subtasks": subtasksVector,
    "views": viewsVector,
    "format": formatVector,
    "notifications": notificationsVector,
    "store": storeVector,
    "snapshot": snapshotVector,
    "quick-add": quickAddVector,
]

// MARK: task.ts

private struct Occurrence: Decodable {
    let due: Due?
    let recurrence: Recurrence?
    let reminders: [Reminder]
}

@Sendable func taskVector(_ fn: String, _ a: Args) throws -> JSONValue {
    switch fn {
    case "addDays": return try json(Dates.addDays(a(0), a(1)))
    case "addInterval": return try json(Dates.addInterval(a(0), a(1), a(2)))
    case "addMonths": return try json(Dates.addMonths(a(0), a(1)))
    case "alignToRecurrence": return try json(Dates.alignToRecurrence(a(0), a(1)))
    case "fromDateKey": return try json(Dates.fromDateKey(a(0), a(1), in: a.zone).epochMilliseconds)
    case "isWeekday": return try json(Dates.isWeekday(a(0)))
    case "weekdayOf": return try json(Dates.weekdayOf(a(0)))
    case "sortWeekdays": return try json(Dates.sortWeekdays(a(0, as: [Weekday].self)))
    case "stepRecurrence": return try json(Dates.stepRecurrence(a(0), a(1)))
    case "toDateKey": return try json(Dates.toDateKey(a.date(0), in: a.zone))
    case "weeklyOn": return try json(Dates.weeklyOn(a(0), a(1, as: [Weekday].self)))
    case "nextOccurrence":
        let task: Occurrence = try a(0)
        guard let next = Dates.nextOccurrence(
            due: task.due, recurrence: task.recurrence, reminders: task.reminders, today: try a(1)
        ) else { return .null }
        return object(["due": try json(next.due), "reminders": try json(next.reminders)])
    case "notificationTimes":
        return try json(Notifications.notificationTimes(a(0), a(1), in: a.zone).map(\.epochMilliseconds))
    case "reminderFiresAt":
        return try json(Notifications.reminderFiresAt(a(0), a(1), in: a.zone)?.epochMilliseconds)
    default: throw unknown(fn)
    }
}

// MARK: subtasks.ts

@Sendable func subtasksVector(_ fn: String, _ a: Args) throws -> JSONValue {
    switch fn {
    case "ancestorsOf": return try json(Subtasks.ancestorsOf(a(0), a(1)))
    case "descendantsOf": return try json(Subtasks.descendantsOf(a(0), a(1)))
    case "detachOrphans": return try json(Subtasks.detachOrphans(a(0)))
    case "groupChildren": return try json(Subtasks.groupChildren(a(0)))
    case "moveSubtask": return try json(Subtasks.moveSubtask(a(0), a(1), a(2)))
    case "nextSiblingOrder": return try json(Subtasks.nextSiblingOrder(a(0), a(1)))
    case "progressOf": return try json(Subtasks.progressOf(a(0)))
    case "reopenTask": return try json(Subtasks.reopenTask(a(0), a(1)))
    case "completeTask":
        guard let completion = Subtasks.completeTask(try a(0), try a(1), today: try a(2), now: try a(3)) else {
            return .null
        }
        switch completion {
        case let .done(changed):
            return object(["kind": "done", "changed": try json(changed)])
        case let .rolled(next, changed):
            return object(["kind": "rolled", "next": try json(next), "changed": try json(changed)])
        }
    default: throw unknown(fn)
    }
}

// MARK: views.ts

@Sendable func viewsVector(_ fn: String, _ a: Args) throws -> JSONValue {
    switch fn {
    case "inboxTasks": return try json(Views.inboxTasks(a(0)))
    case "projectTasks": return try json(Views.projectTasks(a(0), a(1)))
    case "labelTasks": return try json(Views.labelTasks(a(0), a(1)))
    case "todayTasks": return try json(Views.todayTasks(a(0), a(1)))
    case "upcomingGroups": return try json(Views.upcomingGroups(a(0), a(1)))
    default: throw unknown(fn)
    }
}

// MARK: format.ts

@Sendable func formatVector(_ fn: String, _ a: Args) throws -> JSONValue {
    switch fn {
    case "calendarDay": return try json(Format.calendarDay(a(0), a(1)))
    case "clockTime": return try json(Format.clockTime(a(0)))
    case "completedToast": return try json(Format.completedToast(a(0), a(1), a(2)))
    case "dayHeading": return try json(Format.dayHeading(a(0), a(1)))
    case "dueTone": return try json(Format.dueTone(a(0), a(1)))
    case "formatDate": return try json(Format.formatDate(a(0), a(1)))
    case "formatDue": return try json(Format.formatDue(a(0), a(1)))
    case "formatMinutes": return try json(Format.formatMinutes(a(0)))
    case "formatRecurrence": return try json(Format.formatRecurrence(a(0), a(1)))
    case "formatReminder": return try json(Format.formatReminder(a(0), a(1)))
    case "formatTime": return try json(Format.formatTime(a(0)))
    case "priorityLabel": return try json(Format.priorityLabel(a(0)))
    case "relativeDay": return try json(Format.relativeDay(a(0), a(1)))
    case "reminderToast": return try json(Format.reminderToast(a(0)))
    case "repeatLabel": return try json(Format.repeatLabel(a(0), a(1)))
    default: throw unknown(fn)
    }
}

// MARK: notifications.ts

@Sendable func notificationsVector(_ fn: String, _ a: Args) throws -> JSONValue {
    switch fn {
    case "notificationBody":
        return try json(Notifications.notificationBody(a(0), at: a.date(1), in: a.zone))
    case "upcomingNotifications":
        let scheduled = Notifications.upcomingNotifications(try a(0), now: try a.date(1), limit: try a(2), in: a.zone)
        return .array(scheduled.map { n in
            object([
                "at": .number(Double(n.at.epochMilliseconds)),
                "taskId": .string(n.taskId),
                "title": .string(n.title),
                "body": .string(n.body),
            ])
        })
    default: throw unknown(fn)
    }
}

// MARK: store.ts

private struct CreationInput: Decodable {
    let id: String
    let now: Int

    var creation: Creation { Creation(id: id, now: now) }
}

private func patch(_ value: JSONValue) throws -> TaskPatch {
    guard case let .object(fields) = value else { throw VectorError(description: "A patch must be an object") }
    var patch = TaskPatch()
    for (key, field) in fields {
        switch key {
        case "title": patch.title = try decode(field)
        case "notes": patch.notes = try decode(field)
        case "projectId": patch.projectId = .some(try decode(field))
        case "labelIds": patch.labelIds = try decode(field)
        case "due": patch.due = .some(try decode(field))
        case "recurrence": patch.recurrence = .some(try decode(field))
        case "priority": patch.priority = try decode(field)
        case "reminders": patch.reminders = try decode(field)
        default: throw VectorError(description: "Unknown patch field \(key)")
        }
    }
    return patch
}

private func completion(_ completion: Completion) throws -> JSONValue {
    var fields: [String: JSONValue] = ["previous": try json(completion.previous)]
    if let next = completion.next {
        fields["kind"] = "rolled"
        fields["next"] = try json(next)
    } else {
        fields["kind"] = "done"
    }
    return .object(fields)
}

@Sendable func storeVector(_ fn: String, _ a: Args) throws -> JSONValue {
    let data: () throws -> StoreData = { try a(0) }
    switch fn {
    case "sortTasks": return try json(StoreRules.sortTasks(a(0)))
    case "addTask":
        let result = StoreRules.addTask(try data(), try a(1), parentId: try a(2), try a(3, as: CreationInput.self).creation)
        return object(["data": try json(result.data), "task": try json(result.task)])
    case "updateTask": return try json(StoreRules.updateTask(data(), a(1), patch(a.values[2])))
    case "completeTask":
        guard let result = StoreRules.completeTask(try data(), try a(1), today: try a(2), now: try a(3)) else {
            return .null
        }
        return object(["data": try json(result.data), "completion": try completion(result.completion)])
    case "reopenTask": return try json(StoreRules.reopenTask(data(), a(1)))
    case "restoreCompletion": return try json(StoreRules.restoreCompletion(data(), a(1)))
    case "moveSubtask": return try json(StoreRules.moveSubtask(data(), a(1), a(2)))
    case "deleteTask":
        let result = StoreRules.deleteTask(try data(), try a(1))
        return object(["data": try json(result.data), "removed": try json(result.removed)])
    case "undeleteTasks": return try json(StoreRules.undeleteTasks(data(), a(1)))
    case "addProject":
        let result = StoreRules.addProject(try data(), try a(1), try a(2, as: CreationInput.self).creation)
        return object(["data": try json(result.data), "project": try json(result.project)])
    case "renameProject": return try json(StoreRules.renameProject(data(), a(1), a(2)))
    case "deleteProject": return try json(StoreRules.deleteProject(data(), a(1)))
    case "addLabel":
        let result = StoreRules.addLabel(try data(), try a(1), try a(2, as: CreationInput.self).creation)
        return object(["data": try json(result.data), "label": try json(result.label)])
    case "renameLabel": return try json(StoreRules.renameLabel(data(), a(1), a(2)))
    case "deleteLabel": return try json(StoreRules.deleteLabel(data(), a(1)))
    default: throw unknown(fn)
    }
}

// MARK: snapshot.ts

@Sendable func snapshotVector(_ fn: String, _ a: Args) throws -> JSONValue {
    switch fn {
    case "parseSnapshot":
        let document = try JSONEncoder().encode(a.values[0])
        return try json(Snapshot.load(document, now: a(1)))
    default: throw unknown(fn)
    }
}

// MARK: quick-add.ts

private struct ParseInput: Decodable {
    let now: Int
    let projects: [Project]?
    let labels: [Label]?
    let disabled: [String]?
    let due: Due?

    var options: QuickAdd.Options {
        QuickAdd.Options(
            now: Date(epochMilliseconds: now),
            projects: projects ?? [],
            labels: labels ?? [],
            disabled: disabled ?? [],
            due: due
        )
    }
}

@Sendable func quickAddVector(_ fn: String, _ a: Args) throws -> JSONValue {
    switch fn {
    case "parseQuickAdd": return try json(QuickAdd.parse(a(0), a(1, as: ParseInput.self).options, in: a.zone))
    default: throw unknown(fn)
    }
}

extension JSONValue: ExpressibleByStringLiteral {
    public init(stringLiteral value: String) { self = .string(value) }
}
