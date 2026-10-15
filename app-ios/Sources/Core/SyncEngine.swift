import CoreFoundation
import Foundation

/// Field-level sync for the local document: diff a commit into the outbox, and apply the server's answer.
public enum SyncEngine {
    /// The most log rows one response carries. A full page means another round is due.
    public static let pageSize = 1000

    /// Gives a document its sync section. Nothing stored is queued: the first snapshot queues only what the server
    /// lacks (see `seedPatches`), so an install with the same tasks as the server uploads none of them.
    public static func ensure(_ snapshot: inout Snapshot, deviceId: String, now: Int, timeZone: String, nextOpId: () -> String) {
        guard snapshot.sync == nil else { return }
        snapshot.sync = SyncSection(
            deviceId: deviceId,
            cursor: 0,
            outbox: [],
            clock: "0:0:\(deviceId)",
            timeZone: timeZone,
            seed: true
        )
        append(&snapshot, kind: .settings, id: "settings", fields: ["timeZone": .string(timeZone)], now: now, nextOpId: nextOpId)
    }

    /// Queues one op per entity the command changed. A delete-all's `reset` flag stays set.
    public static func record(
        _ snapshot: inout Snapshot,
        before: StoreData,
        after: StoreData,
        now: Int,
        nextOpId: () -> String
    ) {
        guard var sync = snapshot.sync else { return }
        let patches = diff(
            before: synced(before, timeZone: sync.timeZone, dictation: sync.dictation),
            after: synced(after, timeZone: sync.timeZone, dictation: sync.dictation)
        )
        guard !patches.isEmpty else { return }
        var clock = parseClock(sync.clock)
        sync.outbox = enqueue(sync.outbox, stamp(patches, clock: &clock, now: now, nextOpId: nextOpId))
        sync.clock = format(clock)
        sync.timeZone = afterTimeZone(after, fallback: sync.timeZone)
        snapshot.sync = sync
    }

    /// Writes the dictation choice and keeps it on the document, so the next sync and the other devices see it.
    public static func setDictation(
        _ snapshot: inout Snapshot,
        _ choice: DictationChoice,
        now: Int,
        nextOpId: () -> String
    ) {
        guard snapshot.sync?.dictation != choice else { return }
        append(&snapshot, kind: .settings, id: "settings", fields: ["dictation": .string(choice.rawValue)], now: now, nextOpId: nextOpId)
        if var sync = snapshot.sync {
            sync.dictation = choice
            snapshot.sync = sync
        }
    }

    /// Writes the device zone only when it changed since this device last wrote it.
    public static func noteTimeZone(_ snapshot: inout Snapshot, _ timeZone: String, now: Int, nextOpId: () -> String) {
        guard snapshot.sync?.timeZone != timeZone else { return }
        append(&snapshot, kind: .settings, id: "settings", fields: ["timeZone": .string(timeZone)], now: now, nextOpId: nextOpId)
        if var sync = snapshot.sync {
            sync.timeZone = timeZone
            snapshot.sync = sync
        }
    }

    private static func append(
        _ snapshot: inout Snapshot,
        kind: SyncOp.Kind,
        id: String,
        fields: [String: JSONValue],
        now: Int,
        nextOpId: () -> String
    ) {
        guard var sync = snapshot.sync else { return }
        var clock = parseClock(sync.clock)
        let ops = stamp([SyncPatch(kind: kind, id: id, fields: fields)], clock: &clock, now: now, nextOpId: nextOpId)
        sync.outbox = enqueue(sync.outbox, ops)
        sync.clock = format(clock)
        snapshot.sync = sync
    }

    private static func stamp(_ patches: [SyncPatch], clock: inout Clock, now: Int, nextOpId: () -> String) -> [SyncOp] {
        patches.map { patch in
            clock = tick(clock, now: now)
            return SyncOp(opId: nextOpId(), hlc: format(clock), kind: patch.kind, id: patch.id, fields: patch.fields)
        }
    }

    /// Adds ops to the outbox so it holds at most one value per entity field, the latest, each with the clock it was
    /// written at, as `enqueue` in `shared/sync/apply.ts` does. An op carrying `deleted` replaces the entity's queued
    /// ops, an edit to an entity whose create is queued folds into it under the edit's id and clock, and any other
    /// edit takes its fields out of the older ops, dropping the ones left empty.
    public static func enqueue(_ outbox: [SyncOp], _ ops: [SyncOp]) -> [SyncOp] {
        ops.reduce(into: outbox) { queued, op in
            let same = { (other: SyncOp) in other.kind == op.kind && other.id == op.id }
            if op.fields["deleted"] != nil {
                queued.removeAll(where: same)
                queued.append(op)
                return
            }
            if let index = queued.firstIndex(where: { same($0) && $0.fields["deleted"] == .bool(false) }) {
                queued[index].opId = op.opId
                queued[index].hlc = op.hlc
                queued[index].fields.merge(op.fields) { _, new in new }
                return
            }
            queued = queued.compactMap { other in
                guard same(other) else { return other }
                var rest = other
                for name in op.fields.keys { rest.fields.removeValue(forKey: name) }
                return rest.fields.isEmpty ? nil : rest
            }
            queued.append(op)
        }
    }

    /// What a device's local data adds to the server's on its first sync: the entities the server lacks and the
    /// fields it holds differently. Nothing the server has is removed, and its settings stay.
    public static func seedPatches(server: StoreData, local: StoreData) -> [SyncPatch] {
        func union<T: Identifiable>(_ mine: [T], _ theirs: [T]) -> [T] where T.ID == String {
            let ids = Set(mine.map(\.id))
            return mine + theirs.filter { !ids.contains($0.id) }
        }
        return entityDiff(
            kind: .project,
            before: server.projects.map(fieldsOf),
            after: union(local.projects, server.projects).map(fieldsOf)
        ) + entityDiff(
            kind: .label,
            before: server.labels.map(fieldsOf),
            after: union(local.labels, server.labels).map(fieldsOf)
        ) + entityDiff(
            kind: .task,
            before: server.tasks.map(fieldsOf),
            after: union(local.tasks, server.tasks).map(fieldsOf)
        )
    }

    /// Replaces the document for a different signed-in user. The device id stays. The next sync pulls a snapshot.
    public static func replaceForNewUser(_ snapshot: inout Snapshot) {
        let deviceId = snapshot.sync?.deviceId ?? UUID().uuidString.lowercased()
        let timeZone = snapshot.sync?.timeZone ?? "UTC"
        let clock = snapshot.sync?.clock ?? "0:0:\(deviceId)"
        snapshot.tasks = []
        snapshot.projects = []
        snapshot.labels = []
        snapshot.spaces = [:]
        snapshot.people = []
        snapshot.sync = SyncSection(
            deviceId: deviceId,
            cursor: 0,
            outbox: [],
            clock: clock,
            timeZone: timeZone,
            dictation: .native,
            epoch: 0,
            reset: false
        )
    }

    /// Empties tasks, projects, and labels, and asks the next sync to wipe them on the server.
    public static func deleteAll(_ snapshot: inout Snapshot) {
        snapshot.tasks = []
        snapshot.projects = []
        snapshot.labels = []
        guard var sync = snapshot.sync else { return }
        sync.cursor = 0
        sync.outbox = []
        sync.reset = true
        snapshot.sync = sync
    }

    /// The body of `POST /api/sync`, or nil when this document has not started.
    public static func requestJSON(_ snapshot: Snapshot) -> Data? {
        guard let sync = snapshot.sync else { return nil }
        var body: [String: Any] = [
            "cursor": sync.cursor,
            "ops": (try? JSONSerialization.jsonObject(with: JSONEncoder().encode(sync.outbox))) ?? [],
            "epoch": sync.epoch,
        ]
        if sync.reset { body["reset"] = true }
        return try? JSONSerialization.data(withJSONObject: body)
    }

    /// The body of `POST /api/sync` as the contract types it, or nil when this document has not started. Throws when
    /// the outbox holds an op the contract rejects, which the server would answer with a 400.
    public static func request(_ snapshot: Snapshot) throws -> API.SyncRequest? {
        var repaired = snapshot
        repaired.sync?.outbox = snapshot.sync?.outbox.map(repairBooleanNumbers) ?? []
        guard let json = requestJSON(repaired) else { return nil }
        return try JSONDecoder.validating().decode(API.SyncRequest.self, from: json)
    }

    /// Builds up to 2026.1011.235500 stored `0` and `1` as booleans in numeric fields, and their outboxes still
    /// hold those ops. Only 0 and 1 were turned into booleans, so turning them back is exact, as the server does.
    static func repairBooleanNumbers(_ op: SyncOp) -> SyncOp {
        guard op.kind != .settings else { return op }
        func number(_ value: JSONValue) -> JSONValue {
            if case let .bool(flag) = value { return .number(flag ? 1 : 0) }
            return value
        }
        var next = op
        for name in ["order", "createdAt", "completedAt", "priority"] {
            if let value = next.fields[name] { next.fields[name] = number(value) }
        }
        guard op.kind == .task else { return next }
        if case var .object(recurrence) = next.fields["recurrence"] {
            if let interval = recurrence["interval"] { recurrence["interval"] = number(interval) }
            if case let .array(days) = recurrence["days"] { recurrence["days"] = .array(days.map(number)) }
            next.fields["recurrence"] = .object(recurrence)
        }
        if case let .array(reminders) = next.fields["reminders"] {
            next.fields["reminders"] = .array(reminders.map { reminder in
                guard case var .object(fields) = reminder, let minutes = fields["minutes"] else { return reminder }
                fields["minutes"] = number(minutes)
                return .object(fields)
            })
        }
        return next
    }

    /// Applies a response the contract already decoded. Its `T??` fields keep every `null`, so the JSON is the same.
    public static func apply(_ snapshot: inout Snapshot, response: API.SyncResponse, now: Int, nextOpId: () -> String) -> Bool {
        guard let json = try? JSONEncoder().encode(response) else { return false }
        return apply(&snapshot, response: json, now: now, nextOpId: nextOpId)
    }

    /// Applies a sync response. A new epoch drops the outbox so a wiped copy cannot be uploaded again. The first
    /// snapshot of a seeding document queues what its local data adds, so the caller syncs again when the outbox
    /// is not empty.
    public static func apply(_ snapshot: inout Snapshot, response json: Data, now: Int, nextOpId: () -> String) -> Bool {
        guard var sync = snapshot.sync,
              let object = try? JSONSerialization.jsonObject(with: json) as? [String: Any],
              let cursor = intValue(object["cursor"]),
              let epoch = intValue(object["epoch"]),
              let hlc = object["hlc"] as? String,
              isHlc(hlc) else { return false }
        let acked = Set((object["acked"] as? [String]) ?? [])
        let epochChanged = epoch != sync.epoch
        let sentReset = sync.reset
        var seeds: [SyncPatch] = []
        if let raw = object["snapshot"] as? [String: Any], let data = try? JSONSerialization.data(withJSONObject: raw),
           let decoded = try? JSONDecoder().decode(API.SyncSnapshot.self, from: data) {
            let local = snapshot.data
            snapshot.tasks = StoreRules.sortTasks(decoded.tasks)
            snapshot.projects = decoded.projects.sorted(by: byCreation)
            snapshot.labels = decoded.labels.sorted(by: byCreation)
            sync.dictation = decoded.settings.dictation
            if let zone = decoded.settings.timeZone { sync.timeZone = zone }
            if sync.seed {
                seeds = seedPatches(server: snapshot.data, local: local)
                sync.seed = false
            }
        } else if let changes = object["changes"] as? [[String: Any]] {
            for change in changes { applyChange(&snapshot, change) }
            snapshot.tasks = StoreRules.sortTasks(snapshot.tasks)
        }
        let kept = (epochChanged && !sentReset) ? [] : sync.outbox.filter { !acked.contains($0.opId) }
        if sentReset && epochChanged { replay(&snapshot, kept) }
        var clock = observe(parseClock(sync.clock), hlc)
        let seeded = stamp(seeds, clock: &clock, now: now, nextOpId: nextOpId)
        replay(&snapshot, seeded)
        sync.outbox = enqueue(kept, seeded)
        sync.cursor = cursor
        sync.epoch = epoch
        sync.reset = false
        sync.clock = format(clock)
        // A settings change writes the adopted zone and dictation onto the document. Keep them with the new cursor.
        if let adopted = snapshot.sync {
            sync.timeZone = adopted.timeZone
            sync.dictation = adopted.dictation
        }
        snapshot.sync = sync
        return true
    }

    private static func replay(_ snapshot: inout Snapshot, _ ops: [SyncOp]) {
        guard !ops.isEmpty else { return }
        for op in ops {
            guard let data = try? JSONEncoder().encode(op.fields),
                  let fields = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }
            applyChange(&snapshot, ["kind": op.kind.rawValue, "id": op.id, "fields": fields])
        }
        snapshot.tasks = StoreRules.sortTasks(snapshot.tasks)
    }

    private static func applyChange(_ snapshot: inout Snapshot, _ change: [String: Any]) {
        guard let kind = change["kind"] as? String, let id = change["id"] as? String,
              let fields = change["fields"] as? [String: Any] else { return }
        if boolValue(fields["deleted"]) == true {
            switch kind {
            case "task": snapshot.tasks.removeAll { $0.id == id }
            case "project": snapshot.projects.removeAll { $0.id == id }
            case "label": snapshot.labels.removeAll { $0.id == id }
            default: break
            }
            return
        }
        switch kind {
        case "task": merge(&snapshot.tasks, id: id, fields: fields, defaults: taskDefaults)
        case "project": merge(&snapshot.projects, id: id, fields: fields)
        case "label": merge(&snapshot.labels, id: id, fields: fields)
        case "settings":
            guard var sync = snapshot.sync else { break }
            if let zone = fields["timeZone"] as? String { sync.timeZone = zone }
            if let raw = fields["dictation"] as? String, let choice = DictationChoice(rawValue: raw) {
                sync.dictation = choice
            }
            snapshot.sync = sync
        default: break
        }
    }
}

private struct SyncedData {
    var tasks: [TaskItem]
    var projects: [Project]
    var labels: [Label]
    var timeZone: String?
    var dictation: DictationChoice
}

/// One entity's changed fields, before a clock and an op id make it a `SyncOp`.
public struct SyncPatch: Hashable, Encodable, Sendable {
    public var kind: SyncOp.Kind
    public var id: String
    public var fields: [String: JSONValue]
}

private func synced(_ data: StoreData, timeZone: String, dictation: DictationChoice) -> SyncedData {
    SyncedData(tasks: data.tasks, projects: data.projects, labels: data.labels, timeZone: timeZone, dictation: dictation)
}

private func afterTimeZone(_ data: StoreData, fallback: String) -> String { fallback }

private func diff(before: SyncedData, after: SyncedData) -> [SyncPatch] {
    var patches: [SyncPatch] = []
    patches += entityDiff(kind: .project, before: before.projects.map(fieldsOf), after: after.projects.map(fieldsOf))
    patches += entityDiff(kind: .label, before: before.labels.map(fieldsOf), after: after.labels.map(fieldsOf))
    patches += entityDiff(kind: .task, before: before.tasks.map(fieldsOf), after: after.tasks.map(fieldsOf))
    let prior = settingsFields(before.timeZone, before.dictation)
    let next = settingsFields(after.timeZone, after.dictation)
    if !sameJSON(prior, next) {
        patches.append(SyncPatch(kind: .settings, id: "settings", fields: jsonFields(next)))
    }
    return patches
}

private func entityDiff(kind: SyncOp.Kind, before: [[String: Any]], after: [[String: Any]]) -> [SyncPatch] {
    let previous = Dictionary(uniqueKeysWithValues: before.map { ($0["id"] as? String ?? "", $0) })
    var patches: [SyncPatch] = []
    var kept = Set<String>()
    for entity in after {
        guard let id = entity["id"] as? String else { continue }
        kept.insert(id)
        var next = entity
        next.removeValue(forKey: "id")
        guard let old = previous[id] else {
            var created = next
            created["deleted"] = false
            patches.append(SyncPatch(kind: kind, id: id, fields: jsonFields(created)))
            continue
        }
        var prior = old
        prior.removeValue(forKey: "id")
        var changed: [String: Any] = [:]
        for (name, value) in next where !sameJSON(prior[name] ?? NSNull(), value) {
            changed[name] = value
        }
        if !changed.isEmpty { patches.append(SyncPatch(kind: kind, id: id, fields: jsonFields(changed))) }
    }
    for id in previous.keys where !kept.contains(id) && !id.isEmpty {
        patches.append(SyncPatch(kind: kind, id: id, fields: ["deleted": .bool(true)]))
    }
    return patches
}

private func fieldsOf(_ task: TaskItem) -> [String: Any] {
    var fields = jsonObject(task)
    if fields["sourceKey"] == nil { fields["sourceKey"] = NSNull() }
    return fields
}

private func fieldsOf(_ project: Project) -> [String: Any] {
    var fields = jsonObject(project)
    if fields["sourceKey"] == nil { fields["sourceKey"] = NSNull() }
    return fields
}

private func fieldsOf(_ label: Label) -> [String: Any] { jsonObject(label) }

private func settingsFields(_ timeZone: String?, _ dictation: DictationChoice) -> [String: Any] {
    ["id": "settings", "timeZone": timeZone ?? NSNull(), "dictation": dictation.rawValue]
}

private func jsonObject<T: Encodable>(_ value: T) -> [String: Any] {
    guard let data = try? JSONEncoder().encode(value),
          let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
    return object
}

private func jsonFields(_ object: [String: Any]) -> [String: JSONValue] {
    object.compactMapValues { jsonValue($0) }
}

private func jsonValue(_ value: Any) -> JSONValue? {
    if value is NSNull { return .null }
    if let value = value as? String { return .string(value) }
    // Before `as? Bool`: on Apple platforms a JSON 0 or 1 casts to Bool too, which sent `order: 0` as `false`.
    if let value = value as? NSNumber {
        if CFGetTypeID(value) == CFBooleanGetTypeID() { return .bool(value.boolValue) }
        return .number(value.doubleValue)
    }
    if let value = value as? Bool { return .bool(value) }
    if let value = value as? [Any] { return .array(value.compactMap(jsonValue)) }
    if let value = value as? [String: Any] { return .object(value.compactMapValues(jsonValue)) }
    return nil
}

private func sameJSON(_ a: Any, _ b: Any) -> Bool {
    if a is NSNull && b is NSNull { return true }
    if let a = a as? String, let b = b as? String { return a == b }
    if let a = a as? NSNumber, let b = b as? NSNumber, CFGetTypeID(a) == CFBooleanGetTypeID(),
       CFGetTypeID(b) == CFBooleanGetTypeID() {
        return a.boolValue == b.boolValue
    }
    if let a = a as? NSNumber, let b = b as? NSNumber { return a.doubleValue == b.doubleValue }
    if let a = a as? [Any], let b = b as? [Any], a.count == b.count {
        return zip(a, b).allSatisfy { sameJSON($0, $1) }
    }
    if let a = a as? [String: Any], let b = b as? [String: Any], a.count == b.count {
        return a.allSatisfy { key, value in b[key].map { sameJSON(value, $0) } ?? false }
    }
    return false
}

/// Task fields added after launch, which a task the server stored before them lacks. They start as `null`, as
/// `entityFrom` fills them.
private let taskDefaults = ["location", "event", "createdBy", "completedBy", "lastCompletedAt"]

private func merge<T: Codable & Identifiable>(
    _ items: inout [T], id: String, fields: [String: Any], defaults: [String] = []
) where T.ID == String {
    var object: [String: Any]
    if let index = items.firstIndex(where: { $0.id == id }) {
        object = jsonObject(items[index])
    } else {
        object = ["id": id]
        for key in defaults { object[key] = NSNull() }
    }
    for (key, value) in fields where key != "deleted" { object[key] = value }
    if object["sourceKey"] is NSNull { object.removeValue(forKey: "sourceKey") }
    guard JSONSerialization.isValidJSONObject(object),
          let data = try? JSONSerialization.data(withJSONObject: object),
          let decoded = try? JSONDecoder().decode(T.self, from: data) else { return }
    if let index = items.firstIndex(where: { $0.id == id }) { items[index] = decoded }
    else { items.append(decoded) }
}

private func byCreation<T>(_ a: T, _ b: T) -> Bool where T: Identifiable, T.ID == String {
    let left = createdAt(of: a)
    let right = createdAt(of: b)
    if left != right { return left < right }
    return a.id < b.id
}

private func createdAt<T>(of value: T) -> Int {
    if let project = value as? Project { return project.createdAt }
    if let label = value as? Label { return label.createdAt }
    return 0
}

private struct Clock { var wall: Int; var counter: Int; var node: String }

private func parseClock(_ hlc: String) -> Clock {
    let parts = hlc.split(separator: ":", maxSplits: 2, omittingEmptySubsequences: false)
    return Clock(wall: Int(parts[0]) ?? 0, counter: Int(parts[1]) ?? 0, node: String(parts[2]))
}

private func format(_ clock: Clock) -> String { "\(clock.wall):\(clock.counter):\(clock.node)" }

private func tick(_ clock: Clock, now: Int) -> Clock {
    now > clock.wall ? Clock(wall: now, counter: 0, node: clock.node) : Clock(wall: clock.wall, counter: clock.counter + 1, node: clock.node)
}

private func observe(_ clock: Clock, _ hlc: String) -> Clock {
    let seen = parseClock(hlc)
    let later = seen.wall > clock.wall || (seen.wall == clock.wall && seen.counter > clock.counter)
    return later ? Clock(wall: seen.wall, counter: seen.counter, node: clock.node) : clock
}

private func intValue(_ value: Any?) -> Int? {
    if let value = value as? Int { return value }
    if let value = value as? NSNumber { return value.intValue }
    return nil
}

private func boolValue(_ value: Any?) -> Bool? {
    if let value = value as? Bool { return value }
    if let value = value as? NSNumber, CFGetTypeID(value) == CFBooleanGetTypeID() { return value.boolValue }
    return nil
}
