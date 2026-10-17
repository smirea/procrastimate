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
        let patches = diff(before: before, after: after)
        guard !patches.isEmpty else { return }
        var clock = parseClock(sync.clock)
        sync.outbox = enqueue(sync.outbox, stamp(patches, clock: &clock, now: now, nextOpId: nextOpId))
        sync.clock = format(clock)
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

    /// Writes the pinned quick add buttons, in row order, and keeps them on the document like dictation.
    public static func setQuickAddButtons(
        _ snapshot: inout Snapshot,
        _ buttons: [QuickAddButton],
        now: Int,
        nextOpId: () -> String
    ) {
        guard snapshot.sync?.quickAddButtons != buttons else { return }
        let value = JSONValue.array(buttons.map { .string($0.rawValue) })
        append(&snapshot, kind: .settings, id: "settings", fields: ["quickAddButtons": value], now: now, nextOpId: nextOpId)
        if var sync = snapshot.sync {
            sync.quickAddButtons = buttons
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
        snapshot.data = StoreData()
        snapshot.spaces = [:]
        snapshot.people = []
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

    /// Empties tasks, projects, sections, and labels, and asks the next sync to wipe them on the server.
    public static func deleteAll(_ snapshot: inout Snapshot) {
        snapshot.data = StoreData()
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

    /// The body of `POST /api/sync` as the contract types it, or nil when this document has not started. The contract
    /// leaves each op to the server, which rejects an invalid one alone, so only a broken envelope throws.
    public static func request(_ snapshot: Snapshot) throws -> API.SyncRequest? {
        guard let json = requestJSON(snapshot) else { return nil }
        return try JSONDecoder.validating().decode(API.SyncRequest.self, from: json)
    }

    /// Splits the outbox by the server's answer: the ops still waiting, and the ones it rejected, which never apply.
    public static func settle(
        _ outbox: [SyncOp], acked: [String], rejected: [API.SyncRejection]
    ) -> (outbox: [SyncOp], rejected: [SyncOp]) {
        let done = Set(acked)
        let refused = Set(rejected.map(\.opId))
        return (
            outbox.filter { !done.contains($0.opId) && !refused.contains($0.opId) },
            outbox.filter { refused.contains($0.opId) }
        )
    }

    /// The notice for rejected ops, named by what `data` shows for their entity before the server's value replaces it.
    public static func rejectionNotice(_ data: StoreData, _ rejected: [SyncOp]) -> String? {
        var seen = Set<String>()
        let entities = rejected.filter { seen.insert("\($0.kind.rawValue):\($0.id)").inserted }
        guard let first = entities.first else { return nil }
        if entities.count > 1 { return "Couldn’t save changes to \(entities.count) items" }
        let name: String? = switch first.kind {
        case .task: data.tasks.first { $0.id == first.id }?.title
        case .project: data.projects.first { $0.id == first.id }?.name
        case .section: data.sections.first { $0.id == first.id }?.name
        case .label: data.labels.first { $0.id == first.id }?.name
        default: nil
        }
        return name.map { "Couldn’t save a change to “\($0)”" } ?? "Couldn’t save a change"
    }

    /// Applies a response the contract already decoded. Its `T??` fields keep every `null`, so the JSON is the same.
    public static func apply(_ snapshot: inout Snapshot, response: API.SyncResponse, now: Int, nextOpId: () -> String) -> [SyncOp]? {
        guard let json = try? JSONEncoder().encode(response) else { return nil }
        return apply(&snapshot, response: json, now: now, nextOpId: nextOpId)
    }

    /// Applies a sync response and returns the ops the server rejected, or nil when the response is unreadable. A new
    /// epoch drops the outbox so a wiped copy cannot be uploaded again. A rejection comes with the snapshot, so the
    /// rejected op's entity shows the server's value again. The first snapshot of a seeding document queues what its
    /// local data adds, so the caller syncs again when the outbox is not empty.
    public static func apply(_ snapshot: inout Snapshot, response json: Data, now: Int, nextOpId: () -> String) -> [SyncOp]? {
        guard var sync = snapshot.sync,
              let object = try? JSONSerialization.jsonObject(with: json) as? [String: Any],
              let cursor = intValue(object["cursor"]),
              let epoch = intValue(object["epoch"]),
              let hlc = object["hlc"] as? String,
              isHlc(hlc) else { return nil }
        let rejected = ((object["rejected"] as? [[String: Any]]) ?? []).compactMap { entry in
            (entry["opId"] as? String).map { API.SyncRejection(opId: $0, reason: entry["reason"] as? String ?? "") }
        }
        let settled = settle(sync.outbox, acked: (object["acked"] as? [String]) ?? [], rejected: rejected)
        let epochChanged = epoch != sync.epoch
        let sentReset = sync.reset
        var seeds: [SyncPatch] = []
        if let raw = object["snapshot"] as? [String: Any], let data = try? JSONSerialization.data(withJSONObject: raw),
           let decoded = try? JSONDecoder().decode(API.SyncSnapshot.self, from: data) {
            let local = snapshot.data
            snapshot.tasks = StoreRules.sortTasks(decoded.tasks)
            snapshot.projects = decoded.projects.sorted(by: byCreation)
            snapshot.sections = decoded.sections.sorted(by: byCreation)
            snapshot.labels = decoded.labels.sorted(by: byCreation)
            snapshot.comments = decoded.comments.sorted(by: byCreation)
            snapshot.reads = decoded.reads.sorted { $0.id < $1.id }
            sync.dictation = decoded.settings.dictation
            sync.quickAddButtons = decoded.settings.quickAddButtons
            if let zone = decoded.settings.timeZone { sync.timeZone = zone }
            // The adoption below reads the document's section, so it must hold the server's dictation too. The zone
            // stays the one this device last wrote, so two devices in different zones never overwrite each other.
            snapshot.sync?.dictation = sync.dictation
            snapshot.sync?.quickAddButtons = sync.quickAddButtons
            // A wipe this device never saw makes its local copy stale, so it must not upload it.
            if sync.seed && (!epochChanged || sentReset) { seeds = seedPatches(server: snapshot.data, local: local) }
            sync.seed = false
        } else if let changes = object["changes"] as? [[String: Any]] {
            for change in changes { applyChange(&snapshot, change) }
            snapshot.tasks = StoreRules.sortTasks(snapshot.tasks)
        }
        let kept = (epochChanged && !sentReset) ? [] : settled.outbox
        if sentReset && epochChanged { replay(&snapshot, kept) }
        var clock = observe(parseClock(sync.clock), hlc)
        let seeded = stamp(seeds, clock: &clock, now: now, nextOpId: nextOpId)
        replay(&snapshot, seeded)
        sync.outbox = enqueue(kept, seeded)
        sync.cursor = cursor
        sync.epoch = epoch
        sync.reset = false
        sync.clock = format(clock)
        // A settings change writes the adopted settings onto the document. Keep them with the new cursor.
        if let adopted = snapshot.sync {
            sync.timeZone = adopted.timeZone
            sync.dictation = adopted.dictation
            sync.quickAddButtons = adopted.quickAddButtons
        }
        snapshot.sync = sync
        return settled.rejected
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
            case "section": snapshot.sections.removeAll { $0.id == id }
            case "label": snapshot.labels.removeAll { $0.id == id }
            case "comment": snapshot.comments.removeAll { $0.id == id }
            case "read": snapshot.reads.removeAll { $0.id == id }
            default: break
            }
            return
        }
        switch kind {
        case "task": merge(&snapshot.tasks, id: id, fields: fields, defaults: taskDefaults)
        case "project":
            // A project created by a build from before ordering arrives without `order`, as `entityFrom` defaults it.
            var fields = fields
            if fields["order"] == nil, !snapshot.projects.contains(where: { $0.id == id }) { fields["order"] = 0 }
            merge(&snapshot.projects, id: id, fields: fields)
        case "section":
            merge(&snapshot.sections, id: id, fields: fields)
            snapshot.sections.sort(by: byCreation)
        case "label":
            // A label created before colors takes its name's default, and one before places is none, as `entityFrom` gives it.
            var fields = fields
            if !snapshot.labels.contains(where: { $0.id == id }) {
                if fields["color"] == nil, let name = fields["name"] as? String {
                    fields["color"] = LabelColors.defaultLabelColor(name).rawValue
                }
                if fields["place"] == nil { fields["place"] = NSNull() }
            }
            merge(&snapshot.labels, id: id, fields: fields)
        case "comment": merge(&snapshot.comments, id: id, fields: fields)
        case "read": merge(&snapshot.reads, id: id, fields: fields)
        case "settings":
            guard var sync = snapshot.sync else { break }
            if let zone = fields["timeZone"] as? String { sync.timeZone = zone }
            if let raw = fields["dictation"] as? String, let choice = DictationChoice(rawValue: raw) {
                sync.dictation = choice
            }
            if let raw = fields["quickAddButtons"] as? [String] {
                sync.quickAddButtons = raw.compactMap(QuickAddButton.init(rawValue:))
            }
            snapshot.sync = sync
        default: break
        }
    }
}

/// One entity's changed fields, before a clock and an op id make it a `SyncOp`.
public struct SyncPatch: Hashable, Encodable, Sendable {
    public var kind: SyncOp.Kind
    public var id: String
    public var fields: [String: JSONValue]
}

/// Settings change only through their own setters, which append their op directly, so a commit diffs entities alone.
private func diff(before: StoreData, after: StoreData) -> [SyncPatch] {
    var patches: [SyncPatch] = []
    patches += entityDiff(kind: .project, before: before.projects.map(fieldsOf), after: after.projects.map(fieldsOf))
    patches += entityDiff(kind: .section, before: before.sections.map(fieldsOf), after: after.sections.map(fieldsOf))
    patches += entityDiff(kind: .label, before: before.labels.map(fieldsOf), after: after.labels.map(fieldsOf))
    patches += entityDiff(kind: .task, before: before.tasks.map(fieldsOf), after: after.tasks.map(fieldsOf))
    patches += entityDiff(kind: .comment, before: before.comments.map { jsonObject($0) }, after: after.comments.map { jsonObject($0) })
    patches += entityDiff(kind: .read, before: before.reads.map { jsonObject($0) }, after: after.reads.map { jsonObject($0) })
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

private func fieldsOf(_ section: ProjectSection) -> [String: Any] {
    var fields = jsonObject(section)
    if fields["sourceKey"] == nil { fields["sourceKey"] = NSNull() }
    return fields
}

private func fieldsOf(_ label: Label) -> [String: Any] { jsonObject(label) }

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

/// Task fields added after launch, which a task the server stored before them lacks. They start empty, as
/// `entityFrom` fills them.
private var taskDefaults: [String: Any] {
    [
        "sectionId": NSNull(), "location": NSNull(), "event": NSNull(), "images": [Any](), "createdBy": NSNull(),
        "completedBy": NSNull(), "lastCompletedAt": NSNull(),
    ]
}

private func merge<T: Codable & Identifiable>(
    _ items: inout [T], id: String, fields: [String: Any], defaults: [String: Any] = [:]
) where T.ID == String {
    var object: [String: Any]
    if let index = items.firstIndex(where: { $0.id == id }) {
        object = jsonObject(items[index])
    } else {
        object = ["id": id]
        for (key, value) in defaults { object[key] = value }
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
    if let section = value as? ProjectSection { return section.createdAt }
    if let label = value as? Label { return label.createdAt }
    if let comment = value as? Comment { return comment.createdAt }
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
