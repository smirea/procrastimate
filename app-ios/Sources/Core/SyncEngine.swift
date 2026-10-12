import CoreFoundation
import Foundation

/// Field-level sync for the local document: diff a commit into the outbox, and apply the server's answer.
public enum SyncEngine {
    /// The most log rows one response carries. A full page means another round is due.
    public static let pageSize = 1000

    /// Gives a document its sync section, and queues whatever is already stored so the first sync uploads it.
    public static func ensure(_ snapshot: inout Snapshot, deviceId: String, now: Int, timeZone: String, nextOpId: () -> String) {
        guard snapshot.sync == nil else { return }
        snapshot.sync = SyncSection(
            deviceId: deviceId,
            cursor: 0,
            outbox: [],
            clock: "0:0:\(deviceId)",
            timeZone: timeZone
        )
        record(&snapshot, before: StoreData(), after: snapshot.data, now: now, nextOpId: nextOpId)
        append(&snapshot, kind: .settings, id: "settings", fields: ["timeZone": .string(timeZone)], now: now, nextOpId: nextOpId)
    }

    /// Appends one op per entity the command changed. A delete-all's `reset` flag stays set.
    public static func record(
        _ snapshot: inout Snapshot,
        before: StoreData,
        after: StoreData,
        now: Int,
        nextOpId: () -> String
    ) {
        guard var sync = snapshot.sync else { return }
        let patches = diff(before: synced(before, timeZone: sync.timeZone), after: synced(after, timeZone: sync.timeZone))
        guard !patches.isEmpty else { return }
        var clock = parseClock(sync.clock)
        for patch in patches {
            clock = tick(clock, now: now)
            sync.outbox.append(SyncOp(opId: nextOpId(), hlc: format(clock), kind: patch.kind, id: patch.id, fields: patch.fields))
        }
        sync.clock = format(clock)
        sync.timeZone = afterTimeZone(after, fallback: sync.timeZone)
        snapshot.sync = sync
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
        clock = tick(clock, now: now)
        sync.outbox.append(SyncOp(opId: nextOpId(), hlc: format(clock), kind: kind, id: id, fields: fields))
        sync.clock = format(clock)
        snapshot.sync = sync
    }

    /// Replaces the document for a different signed-in user. The device id stays. The next sync pulls a snapshot.
    public static func replaceForNewUser(_ snapshot: inout Snapshot) {
        let deviceId = snapshot.sync?.deviceId ?? UUID().uuidString.lowercased()
        let timeZone = snapshot.sync?.timeZone ?? "UTC"
        let clock = snapshot.sync?.clock ?? "0:0:\(deviceId)"
        snapshot.tasks = []
        snapshot.projects = []
        snapshot.labels = []
        snapshot.sync = SyncSection(
            deviceId: deviceId,
            cursor: 0,
            outbox: [],
            clock: clock,
            timeZone: timeZone,
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
    public static func apply(_ snapshot: inout Snapshot, response: API.SyncResponse) -> Bool {
        guard let json = try? JSONEncoder().encode(response) else { return false }
        return apply(&snapshot, response: json)
    }

    /// Applies a sync response. A new epoch drops the outbox so a wiped copy cannot be uploaded again.
    public static func apply(_ snapshot: inout Snapshot, response json: Data) -> Bool {
        guard var sync = snapshot.sync,
              let object = try? JSONSerialization.jsonObject(with: json) as? [String: Any],
              let cursor = intValue(object["cursor"]),
              let epoch = intValue(object["epoch"]),
              let hlc = object["hlc"] as? String,
              isHlc(hlc) else { return false }
        let acked = Set((object["acked"] as? [String]) ?? [])
        let epochChanged = epoch != sync.epoch
        let sentReset = sync.reset
        if let raw = object["snapshot"] as? [String: Any], let data = try? JSONSerialization.data(withJSONObject: raw),
           let decoded = try? JSONDecoder().decode(API.SyncSnapshot.self, from: data) {
            snapshot.tasks = StoreRules.sortTasks(decoded.tasks)
            snapshot.projects = decoded.projects.sorted(by: byCreation)
            snapshot.labels = decoded.labels.sorted(by: byCreation)
            if let zone = decoded.settings.timeZone { sync.timeZone = zone }
        } else if let changes = object["changes"] as? [[String: Any]] {
            for change in changes { applyChange(&snapshot, change) }
            snapshot.tasks = StoreRules.sortTasks(snapshot.tasks)
        }
        let kept = (epochChanged && !sentReset) ? [] : sync.outbox.filter { !acked.contains($0.opId) }
        if sentReset && epochChanged {
            for op in kept {
                guard let data = try? JSONEncoder().encode(op.fields),
                      let fields = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }
                applyChange(&snapshot, ["kind": op.kind.rawValue, "id": op.id, "fields": fields])
            }
            snapshot.tasks = StoreRules.sortTasks(snapshot.tasks)
        }
        sync.outbox = kept
        sync.cursor = cursor
        sync.epoch = epoch
        sync.reset = false
        sync.clock = format(observe(parseClock(sync.clock), hlc))
        snapshot.sync = sync
        return true
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
        case "task": merge(&snapshot.tasks, id: id, fields: fields)
        case "project": merge(&snapshot.projects, id: id, fields: fields)
        case "label": merge(&snapshot.labels, id: id, fields: fields)
        case "settings":
            if let zone = fields["timeZone"] as? String, var sync = snapshot.sync {
                sync.timeZone = zone
                snapshot.sync = sync
            }
        default: break
        }
    }
}

private struct SyncedData {
    var tasks: [TaskItem]
    var projects: [Project]
    var labels: [Label]
    var timeZone: String?
}

private struct Patch {
    var kind: SyncOp.Kind
    var id: String
    var fields: [String: JSONValue]
}

private func synced(_ data: StoreData, timeZone: String) -> SyncedData {
    SyncedData(tasks: data.tasks, projects: data.projects, labels: data.labels, timeZone: timeZone)
}

private func afterTimeZone(_ data: StoreData, fallback: String) -> String { fallback }

private func diff(before: SyncedData, after: SyncedData) -> [Patch] {
    var patches: [Patch] = []
    patches += entityDiff(kind: .project, before: before.projects.map(fieldsOf), after: after.projects.map(fieldsOf))
    patches += entityDiff(kind: .label, before: before.labels.map(fieldsOf), after: after.labels.map(fieldsOf))
    patches += entityDiff(kind: .task, before: before.tasks.map(fieldsOf), after: after.tasks.map(fieldsOf))
    let prior = settingsFields(before.timeZone)
    let next = settingsFields(after.timeZone)
    if !sameJSON(prior, next) {
        patches.append(Patch(kind: .settings, id: "settings", fields: jsonFields(next)))
    }
    return patches
}

private func entityDiff(kind: SyncOp.Kind, before: [[String: Any]], after: [[String: Any]]) -> [Patch] {
    let previous = Dictionary(uniqueKeysWithValues: before.map { ($0["id"] as? String ?? "", $0) })
    var patches: [Patch] = []
    var kept = Set<String>()
    for entity in after {
        guard let id = entity["id"] as? String else { continue }
        kept.insert(id)
        var next = entity
        next.removeValue(forKey: "id")
        guard let old = previous[id] else {
            var created = next
            created["deleted"] = false
            patches.append(Patch(kind: kind, id: id, fields: jsonFields(created)))
            continue
        }
        var prior = old
        prior.removeValue(forKey: "id")
        var changed: [String: Any] = [:]
        for (name, value) in next where !sameJSON(prior[name] ?? NSNull(), value) {
            changed[name] = value
        }
        if !changed.isEmpty { patches.append(Patch(kind: kind, id: id, fields: jsonFields(changed))) }
    }
    for id in previous.keys where !kept.contains(id) && !id.isEmpty {
        patches.append(Patch(kind: kind, id: id, fields: ["deleted": .bool(true)]))
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

private func settingsFields(_ timeZone: String?) -> [String: Any] {
    ["id": "settings", "timeZone": timeZone ?? NSNull()]
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

private func merge<T: Codable & Identifiable>(_ items: inout [T], id: String, fields: [String: Any]) where T.ID == String {
    var object: [String: Any]
    if let index = items.firstIndex(where: { $0.id == id }) {
        object = jsonObject(items[index])
    } else {
        object = ["id": id]
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
