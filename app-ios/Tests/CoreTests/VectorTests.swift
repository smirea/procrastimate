import Core
import Foundation
import Testing

/// Checks the Swift port against `shared/vectors/*.json`, which `bun run vectors` records from the TypeScript tests.
@Suite struct VectorTests {
    @Test(arguments: VectorFile.all)
    func matchesTypeScript(_ file: VectorFile) throws {
        let zone = try #require(TimeZone(identifier: file.timeZone))
        guard let handler = handlers[file.module] else {
            try #require(pendingPorts.contains(file.module), "No Swift port for shared/\(file.module).ts")
            return
        }
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

    @Test func onlyPendingModulesLackAPort() {
        let missing = Set(VectorFile.all.map(\.module)).subtracting(handlers.keys)
        #expect(missing == pendingPorts)
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

struct Args {
    let values: [JSONValue]
    let zone: TimeZone

    func callAsFunction<T: Decodable>(_ index: Int, as type: T.Type = T.self) throws -> T {
        try decode(index < values.count ? values[index] : .null)
    }

    func date(_ index: Int) throws -> Date { Date(epochMilliseconds: try self(index)) }

    func timeZone(_ index: Int) throws -> TimeZone {
        let name: String = try self(index)
        guard let zone = TimeZone(identifier: name) else { throw unknown("time zone \(name)") }
        return zone
    }
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

private let pendingPorts: Set<String> = []

let handlers: [String: Handler] = [
    "task": taskVector,
    "subtasks": subtasksVector,
    "views": viewsVector,
    "format": formatVector,
    "markdown": markdownVector,
    "notifications": notificationsVector,
    "store": storeVector,
    "quick-add": quickAddVector,
    "csv": csvVector,
    "search": searchVector,
    "name-search": nameSearchVector,
    "todoist": todoistVector,
    "dictation": dictationVector,
    "quick-add-buttons": quickAddButtonsVector,
    "label-colors": labelColorsVector,
    "triggers": triggersVector,
    "ramble": rambleVector,
    "ramble-fill": rambleFillVector,
    "screens": screensVector,
    "memo-tasks": memoTasksVector,
    "links": linksVector,
    "rows": rowsVector,
    "comments": commentsVector,
    "row-actions": rowActionsVector,
    "dangling": danglingVector,
    "local-rows": localRowsVector,
    "space-routing": spaceRoutingVector,
]

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
    case "dueAtTime": return try json(Dates.dueAtTime(a(0), a(1), today: a(2), now: a(3)))
    case "fromDateKey": return try json(Dates.fromDateKey(a(0), a(1), in: a.zone).epochMilliseconds)
    case "isWeekday": return try json(Dates.isWeekday(a(0)))
    case "monthlyWeekdayOf": return try json(Dates.monthlyWeekdayOf(a(0)))
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
        guard let completion = Subtasks.completeTask(
            try a(0), try a(1), today: try a(2), now: try a(3), in: a.values.count > 4 ? try a.timeZone(4) : a.zone
        ) else {
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

@Sendable func viewsVector(_ fn: String, _ a: Args) throws -> JSONValue {
    switch fn {
    case "inboxTasks": return try json(Views.inboxTasks(a(0), a(1), in: a.zone))
    case "noDateTasks": return try json(Views.noDateTasks(a(0), a(1), newestFirst: a(2), in: a.zone))
    case "projectTasks": return try json(Views.projectTasks(a(0), a(1), in: a.zone))
    case "projectGroups": return try json(Views.projectGroups(a(0), a(1), a(2), in: a.zone))
    case "labelTasks": return try json(Views.labelTasks(a(0), a(1), in: a.zone))
    case "placeTasks": return try json(Views.placeTasks(a(0), a(1), in: a.zone))
    case "labelViewTasks": return try json(Views.labelViewTasks(a(0), a(1), in: a.zone))
    case "eventTasks": return try json(Views.eventTasks(a(0), a(1), a(2), in: a.zone))
    case "todayTasks": return try json(Views.todayTasks(a(0), a(1), in: a.zone))
    case "upcomingGroups": return try json(Views.upcomingGroups(a(0), a(1), in: a.zone))
    case "completedRange": return try json(Views.completedRange(a(0), a(1)))
    case "completedTasks": return try json(Views.completedTasks(a(0), a(1), in: a.zone))
    case "completedDays": return try json(Views.completedDays(a(0), a(1), in: a.zone))
    case "projectCompleted": return try json(Views.projectCompleted(a(0), a(1), a(2), in: a.zone))
    case "pendingCount": return try json(Views.pendingCount(a(0)))
    case "openCounts":
        let counts = Views.openCounts(try a(0), try a(1))
        return object(["projects": try json(counts.projects), "labels": try json(counts.labels)])
    default: throw unknown(fn)
    }
}

@Sendable func markdownVector(_ fn: String, _ a: Args) throws -> JSONValue {
    switch fn {
    case "toMarkdown": return try json(Markdown.toMarkdown(a(0), a(1)))
    case "projectDocument": return try json(Markdown.projectDocument(a(0), a(1)))
    default: throw unknown(fn)
    }
}

@Sendable func formatVector(_ fn: String, _ a: Args) throws -> JSONValue {
    switch fn {
    case "calendarDay": return try json(Format.calendarDay(a(0), a(1)))
    case "clockTime": return try json(Format.clockTime(a(0)))
    case "completedToast": return try json(Format.completedToast(a(0), a(1), a(2)))
    case "dayHeading": return try json(Format.dayHeading(a(0), a(1)))
    case "dueTone": return try json(Format.dueTone(a(0), a(1)))
    case "formatDate": return try json(Format.formatDate(a(0), a(1)))
    case "formatDue": return try json(Format.formatDue(a(0), a(1)))
    case "postponeOptions": return try json(Format.postponeOptions(a(0), a(1)))
    case "formatMinutes": return try json(Format.formatMinutes(a(0)))
    case "formatRecurrence": return try json(Format.formatRecurrence(a(0), a(1)))
    case "formatReminder": return try json(Format.formatReminder(a(0), a(1)))
    case "formatTime": return try json(Format.formatTime(a(0)))
    case "priorityLabel": return try json(Format.priorityLabel(a(0)))
    case "relativeDay": return try json(Format.relativeDay(a(0), a(1)))
    case "addedAgo": return try json(Format.addedAgo(a(0), a(1)))
    case "reminderToast": return try json(Format.reminderToast(a(0)))
    case "completedRangeLabel": return try json(Format.completedRangeLabel(a(0), a(1)))
    case "reopenedToast": return try json(Format.reopenedToast(a(0)))
    case "completedWhen": return try json(Format.completedWhen(a.date(0), a(1), in: a.zone))
    case "completedHeading": return try json(Format.completedHeading(a(0), a(1)))
    case "repeatLabel": return try json(Format.repeatLabel(a(0), a(1)))
    default: throw unknown(fn)
    }
}

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
        case "sectionId": patch.sectionId = .some(try decode(field))
        case "labelIds": patch.labelIds = try decode(field)
        case "due": patch.due = .some(try decode(field))
        case "recurrence": patch.recurrence = .some(try decode(field))
        case "priority": patch.priority = try decode(field)
        case "reminders": patch.reminders = try decode(field)
        case "location": patch.location = .some(try decode(field))
        case "event": patch.event = .some(try decode(field))
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

@Sendable func commentsVector(_ fn: String, _ a: Args) throws -> JSONValue {
    switch fn {
    case "commentsOn": return try json(Comments.commentsOn(a(0), a(1)))
    case "commentBadges": return try json(Comments.commentBadges(a(0), a(1), a(2)))
    case "addComment":
        let result = Comments.addComment(try a(0), try a(1), try a(2), try a(3), try a(4, as: CreationInput.self).creation)
        return object(["data": try json(result.data), "comment": try json(result.comment)])
    case "editComment": return try json(Comments.editComment(a(0), a(1), a(2), a(3), a(4)))
    case "deleteComment": return try json(Comments.deleteComment(a(0), a(1), a(2)))
    case "markRead": return try json(Comments.markRead(a(0), a(1), a(2), a(3), a(4)))
    default: throw unknown(fn)
    }
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
        guard let result = StoreRules.completeTask(
            try data(), try a(1), today: try a(2), now: try a(3), in: a.zone
        ) else {
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
    case "explodeSubtasks":
        let result = StoreRules.explodeSubtasks(try data(), try a(1), try a(2))
        return object(["data": try json(result.data), "previous": try json(result.previous)])
    case "restoreExploded": return try json(StoreRules.restoreExploded(data(), a(1)))
    case "addProject":
        let result = StoreRules.addProject(try data(), try a(1), try a(2, as: CreationInput.self).creation)
        return object(["data": try json(result.data), "project": try json(result.project)])
    case "renameProject": return try json(StoreRules.renameProject(data(), a(1), a(2)))
    case "deleteProject": return try json(StoreRules.deleteProject(data(), a(1)))
    case "addLabel":
        let result = StoreRules.addLabel(try data(), try a(1), try a(2, as: CreationInput.self).creation)
        return object(["data": try json(result.data), "label": try json(result.label)])
    case "renameLabel": return try json(StoreRules.renameLabel(data(), a(1), a(2)))
    case "savePlace":
        let result = StoreRules.savePlace(try data(), try a(1), try a(2), try a(3, as: CreationInput.self).creation)
        return object(["data": try json(result.data), "label": try json(result.label)])
    case "setPlaceRadius": return try json(StoreRules.setPlaceRadius(data(), a(1), a(2)))
    case "setLabelColor": return try json(StoreRules.setLabelColor(data(), a(1), a(2)))
    case "deleteLabel": return try json(StoreRules.deleteLabel(data(), a(1)))
    case "sectionsOf": return try json(StoreRules.sectionsOf(a(0), a(1)))
    case "sectionTasks": return try json(StoreRules.sectionTasks(a(0), a(1)))
    case "addSection":
        let result = StoreRules.addSection(try data(), try a(1), try a(2), try a(3, as: CreationInput.self).creation)
        return object(["data": try json(result.data), "section": try json(result.section)])
    case "renameSection": return try json(StoreRules.renameSection(data(), a(1), a(2)))
    case "moveSection": return try json(StoreRules.moveSection(data(), a(1), a(2)))
    case "moveProject": return try json(StoreRules.moveProject(data(), a(1), a(2)))
    case "projectsInOrder": return try json(StoreRules.projectsInOrder(a(0)))
    case "deleteSection": return try json(StoreRules.deleteSection(data(), a(1)))
    case "deletedBetween": return try json(StoreRules.deletedBetween(data(), a(1)))
    case "undelete": return try json(StoreRules.undelete(data(), a(1)))
    default: throw unknown(fn)
    }
}

private struct PlacedInput: Decodable {
    let labelIds: [String]
    let location: TaskLocation?
}

private struct ParseInput: Decodable {
    let now: Int
    let projects: [Project]?
    let sections: [ProjectSection]?
    let labels: [Label]?
    let projectId: String?
    let due: Due?
    let spoken: Bool?

    var options: QuickAdd.Options {
        QuickAdd.Options(
            now: Date(epochMilliseconds: now),
            projects: projects ?? [],
            sections: sections ?? [],
            labels: labels ?? [],
            projectId: projectId,
            due: due,
            spoken: spoken ?? false
        )
    }
}

@Sendable func quickAddVector(_ fn: String, _ a: Args) throws -> JSONValue {
    switch fn {
    case "parseQuickAdd": return try json(QuickAdd.parse(a(0), a(1, as: ParseInput.self).options, in: a.zone))
    default: throw unknown(fn)
    }
}

@Sendable func triggersVector(_ fn: String, _ a: Args) throws -> JSONValue {
    switch fn {
    case "currentOccurrence": return try json(Triggers.currentOccurrence(a(0), a(1), in: a.zone))
    case "eventGroups": return try json(Triggers.eventGroups(a(0), a(1), in: a.zone))
    case "eventLabel": return try json(Triggers.eventLabel(a(0), a(1), in: a.zone))
    case "formatEvent": return try json(Triggers.formatEvent(a(0)))
    case "formatLocation": return try json(Triggers.formatLocation(a(0)))
    case "formatRadius": return try json(Triggers.formatRadius(a(0)))
    case "placeGroups": return try json(Triggers.placeGroups(a(0), a(1)))
    case "placeLocation": return try json(Triggers.placeLocation(a(0), a(1)))
    case "pickedLabels":
        let task = try a(1, as: PlacedInput.self)
        return try json(Triggers.pickedLabels(a(0), labelIds: task.labelIds, location: task.location))
    case "applyPickedLabels":
        let result = Triggers.applyPickedLabels(try a(0), try a(1), try a(2))
        return object(["labelIds": try json(result.labelIds), "location": try json(result.location)])
    case "savedPlaceAt": return try json(Triggers.savedPlaceAt(a(0), a(1)))
    case "scheduledDue": return try json(Triggers.scheduledDue(a(0), a(1), in: a.zone))
    case "taskNotificationTimes":
        return try json(Triggers.taskNotificationTimes(a(0), a(1), in: a.zone).map(\.epochMilliseconds))
    default: throw unknown(fn)
    }
}

@Sendable func dictationVector(_ fn: String, _ a: Args) throws -> JSONValue {
    switch fn {
    case "voiceCapture": return try json(Dictation.voiceCapture(a(0), online: a(1), nativeSpeech: a(2)))
    default: throw unknown(fn)
    }
}

@Sendable func quickAddButtonsVector(_ fn: String, _ a: Args) throws -> JSONValue {
    switch fn {
    case "toggleButton": return try json(QuickAddButtons.toggleButton(a(0), a(1)))
    case "rowButtons": return try json(QuickAddButtons.rowButtons(a(0), a(1), a(2)))
    case "moveButton": return try json(QuickAddButtons.moveButton(a(0), a(1), a(2) as QuickAddButton?))
    default: throw unknown(fn)
    }
}

@Sendable func labelColorsVector(_ fn: String, _ a: Args) throws -> JSONValue {
    switch fn {
    case "defaultLabelColor": return try json(LabelColors.defaultLabelColor(a(0)))
    default: throw unknown(fn)
    }
}

private struct RambleInput: Decodable {
    let now: Int
    let projects: [Project]?
    let labels: [Label]?
}

@Sendable func rambleVector(_ fn: String, _ a: Args) throws -> JSONValue {
    switch fn {
    case "parseRamble":
        let options = try a(1, as: RambleInput.self)
        return try json(
            Ramble.parse(
                try a(0),
                now: Date(epochMilliseconds: options.now),
                projects: options.projects ?? [],
                labels: options.labels ?? [],
                in: a.zone
            )
        )
    default: throw unknown(fn)
    }
}

/// `ListDefaults` in TS, which writes every field, null included.
private struct ListDefaultsJSON: Codable {
    let projectId: String?
    let sectionId: String?
    let labelId: String?
    let location: TaskLocation?
    let event: TaskEvent?
    let date: DateKey?

    init(_ defaults: QuickAddDraft.Defaults) {
        projectId = defaults.projectId
        sectionId = defaults.sectionId
        labelId = defaults.labelId
        location = defaults.location
        event = defaults.event
        date = defaults.date
    }

    var defaults: QuickAddDraft.Defaults {
        .init(projectId: projectId, sectionId: sectionId, labelId: labelId, location: location, event: event, date: date)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(projectId, forKey: .projectId)
        try container.encode(sectionId, forKey: .sectionId)
        try container.encode(labelId, forKey: .labelId)
        try container.encode(location, forKey: .location)
        try container.encode(event, forKey: .event)
        try container.encode(date, forKey: .date)
    }
}

private struct ScreenInput: Decodable {
    let kind: String
    let id: String?
    let key: String?
    let sectionId: String?
    let date: DateKey?

    func screen() throws -> ListScreen {
        switch kind {
        case "inbox": .inbox(date: date)
        case "no-date": .noDate
        case "completed": .completed
        case "project": .project(id: id ?? "", sectionId: sectionId)
        case "label": .label(id: id ?? "")
        case "place": .place(key: key ?? "")
        case "event": .event(id: id ?? "")
        default: throw unknown(kind)
        }
    }
}

/// `SharedSpace` in TS: `{ access }`.
private struct SharedSpaceInput: Decodable {
    let access: [Access]
}

@Sendable func screensVector(_ fn: String, _ a: Args) throws -> JSONValue {
    let screen = try a(0, as: ScreenInput?.self)?.screen()
    switch fn {
    case "screenDefaults": return try json(ListDefaultsJSON(Screens.defaults(screen, a(1), a(2, as: SharedSpaceInput?.self)?.access)))
    case "canAddTo": return try json(Screens.canAdd(to: screen, a(1, as: SharedSpaceInput?.self)?.access))
    case "screenHolds": return try json(Screens.holds(screen, a(1), a(2), in: a.zone))
    default: throw unknown(fn)
    }
}

@Sendable func rambleFillVector(_ fn: String, _ a: Args) throws -> JSONValue {
    switch fn {
    case "rambleNewTask":
        return try json(Ramble.newTask(try a(0), defaults: try a(1, as: ListDefaultsJSON?.self)?.defaults, labels: try a(2)))
    default: throw unknown(fn)
    }
}

extension JSONValue: ExpressibleByStringLiteral {
    public init(stringLiteral value: String) { self = .string(value) }
}

@Sendable func memoTasksVector(_ fn: String, _ a: Args) throws -> JSONValue {
    switch fn {
    case "memoSourceKey": return try json(MemoTasks.memoSourceKey(a(0)))
    case "parseMemoSource": return try json(MemoTasks.parseMemoSource(a(0)))
    default: throw unknown(fn)
    }
}

private struct RowWriteInput: Decodable {
    let op: String
    let kind: EntityKind
    let id: String
    let values: [String: JSONValue]?

    var write: RowWrite { RowWrite(op: RowWrite.Op(rawValue: op)!, kind: kind, id: id, values: values) }
}

private func rowWritesJSON(_ writes: [RowWrite]) -> JSONValue {
    .array(writes.map { write in
        var fields: [String: JSONValue] = ["op": .string(write.op.rawValue), "kind": .string(write.kind.rawValue), "id": .string(write.id)]
        if let values = write.values { fields["values"] = .object(values) }
        return .object(fields)
    })
}

private struct RejectedInput: Decodable {
    let kind: EntityKind
    let id: String
}

@Sendable func rowsVector(_ fn: String, _ a: Args) throws -> JSONValue {
    switch fn {
    case "rowWrites": return rowWritesJSON(Rows.rowWrites(try a(0), try a(1)))
    case "coalesce": return rowWritesJSON(Rows.coalesce(try a(0, as: [RowWriteInput].self).map(\.write)))
    case "rejectionNotice":
        let rejected = try a(1, as: [RejectedInput].self).map { (kind: $0.kind, id: $0.id) }
        return try json(Rows.rejectionNotice(try a(0), rejected))
    default: throw unknown(fn)
    }
}

@Sendable func rowActionsVector(_ fn: String, _ a: Args) throws -> JSONValue {
    switch fn {
    case "rowActions":
        let offered = try RowActions(a(0), readOnly: a(1), rolled: a(2, as: Bool?.self) ?? false)
        return object([
            "toggle": offered.toggle.map { .string($0.rawValue) } ?? .null,
            "postpone": .bool(offered.postpone),
            "delete": .bool(offered.delete),
        ])
    default: throw unknown(fn)
    }
}

private struct EntitiesInput: Decodable {
    let tasks: [TaskItem]
    let projects: [Project]
    let sections: [ProjectSection]
    let labels: [Label]
}

@Sendable func danglingVector(_ fn: String, _ a: Args) throws -> JSONValue {
    switch fn {
    case "resolveDangling":
        let input = try a(0, as: EntitiesInput.self)
        let resolved = Dangling.resolveDangling(
            Snapshot(tasks: input.tasks, projects: input.projects, sections: input.sections, labels: input.labels, settings: API.Settings())
        )
        return object([
            "tasks": try json(resolved.tasks), "projects": try json(resolved.projects),
            "sections": try json(resolved.sections), "labels": try json(resolved.labels),
        ])
    default: throw unknown(fn)
    }
}

private struct RowOwner: Decodable {
    let userId: String
}

private func tableRead<Row>(_ value: JSONValue?, _ row: (JSONValue) -> Row?) throws -> TableRead<Row>? {
    guard case let .object(fields)? = value, case let .array(rows)? = fields["rows"] else { return nil }
    let ids: ReadIds = fields["ids"] == .string("all") ? .all : .some(try decode(fields["ids"] ?? .null))
    return TableRead(ids: ids, rows: rows.compactMap(row))
}

/// A row the TypeScript side would drop as unparseable decodes to nil here, as `LocalDatabase` drops it on the device.
/// Like `SyncedRow`, a null `sourceKey` is left out, which Core reads only as absent.
private func ownedRow<V: Decodable>(_ row: JSONValue) -> Owned<V>? {
    guard case var .object(fields) = row, let owner: RowOwner = try? decode(row) else { return nil }
    if fields["sourceKey"] == .null { fields["sourceKey"] = nil }
    guard let value: V = try? decode(.object(fields)) else { return nil }
    return Owned(owner: owner.userId, value: value)
}

private func rowsRead(_ value: JSONValue) throws -> RowsRead {
    guard case let .object(tables) = value else { throw VectorError(description: "A read is not an object") }
    var read = RowsRead()
    read.tasks = try tableRead(tables["task"], ownedRow)
    read.projects = try tableRead(tables["project"], ownedRow)
    read.sections = try tableRead(tables["section"], ownedRow)
    read.labels = try tableRead(tables["label"], ownedRow)
    read.comments = try tableRead(tables["comment"], ownedRow)
    read.reads = try tableRead(tables["read"], ownedRow)
    read.settings = try tableRead(tables["settings"], ownedRow)
    read.access = try tableRead(tables["access"]) { try? decode($0) as Access }
    return read
}

private func storeData(_ snapshot: Snapshot) throws -> JSONValue {
    object([
        "tasks": try json(snapshot.tasks), "projects": try json(snapshot.projects),
        "sections": try json(snapshot.sections), "labels": try json(snapshot.labels),
        "comments": try json(snapshot.comments), "reads": try json(snapshot.reads),
    ])
}

@Sendable func localRowsVector(_ fn: String, _ a: Args) throws -> JSONValue {
    switch fn {
    case "replayReads":
        let rows = LocalRows(me: try a(0))
        let reads: [JSONValue] = try a(1)
        return .array(try reads.map { read in
            let touched = rows.apply(try rowsRead(read))
            let spaces = rows.spaces
            var shared: [String: JSONValue] = [:]
            for owner in rows.sharers {
                shared[owner] = object([
                    "data": try storeData(spaces.shared[owner] ?? .empty),
                    "access": try json(spaces.access.filter { $0.owner == owner }),
                ])
            }
            return object([
                "touched": try json(touched),
                "own": try storeData(spaces.own),
                "settings": spaces.settingsStored ? try json(spaces.own.settings) : .null,
                "spaces": .object(shared),
            ])
        })
    default: throw unknown(fn)
    }
}

private struct PlacementInput: Decodable {
    let title: String?
    let projectId: String?
    let sectionId: String?
    let labelIds: [String]
}

private struct ListsInput: Decodable {
    let projects: [Project]
    let sections: [ProjectSection]
    let labels: [Label]

    var data: StoreData { StoreData(projects: projects, sections: sections, labels: labels) }
}

private struct SharedSpaceDataInput: Decodable {
    struct Data: Decodable {
        let tasks: [TaskItem]
        let projects: [Project]
        let labels: [Label]
    }

    let owner: Person
    let data: Data
}

@Sendable func spaceRoutingVector(_ fn: String, _ a: Args) throws -> JSONValue {
    switch fn {
    case "creationHome":
        let input: PlacementInput = try a(1)
        return try json(SpaceRouting.creationHome(a(0), projectId: input.projectId, labelIds: input.labelIds, parentId: a(2)))
    case "fitToSpace":
        let input: PlacementInput = try a(1)
        let fitted = SpaceRouting.fitToSpace(
            try a(0, as: ListsInput.self).data,
            NewTask(title: input.title ?? "", projectId: input.projectId, sectionId: input.sectionId, labelIds: input.labelIds)
        )
        var fields: [String: JSONValue] = [
            "projectId": try json(fitted.projectId), "sectionId": try json(fitted.sectionId), "labelIds": try json(fitted.labelIds),
        ]
        if let title = input.title { fields["title"] = .string(title) }
        return object(fields)
    case "fitPatch":
        return try json(SpaceRouting.fitPatch(try a(0, as: ListsInput.self).data, a(1)))
    case "sharedEntries":
        let spaces = try a(0, as: [SharedSpaceDataInput].self).map { space in
            SharedSpace(
                id: space.owner.id, owner: space.owner,
                data: Snapshot(tasks: space.data.tasks, projects: space.data.projects, labels: space.data.labels, settings: API.Settings())
            )
        }
        return .array(try SpaceRouting.sharedEntries(spaces).map { entry in
            object([
                "kind": .string(entry.kind.rawValue), "id": .string(entry.id), "name": .string(entry.name),
                "owner": try json(entry.owner),
            ])
        })
    default: throw unknown(fn)
    }
}
