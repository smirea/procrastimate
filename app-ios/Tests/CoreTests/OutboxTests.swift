import Core
import Foundation
import Testing

@MainActor @Suite struct OutboxTests {
    let clock = AppClock.fixed(pinned, timeZone: TimeZone(identifier: "UTC")!)

    func ids() -> () -> String {
        var next = 0
        return {
            next += 1
            return "op-\(next)"
        }
    }

    @Test func keystrokesInASyncedTitleQueueOneOpWithTheLastValue() {
        var snapshot = Snapshot.empty(now: 0)
        snapshot.tasks = [TaskItem(id: "t1", title: "", createdAt: 10)]
        SyncEngine.ensure(&snapshot, deviceId: "phone", now: 0, timeZone: "UTC") { "zone" }
        snapshot.sync?.outbox = []
        let next = ids()
        for (i, title) in ["M", "Mi", "Mil", "Milk"].enumerated() {
            let before = snapshot.data
            snapshot.tasks[0].title = title
            SyncEngine.record(&snapshot, before: before, after: snapshot.data, now: 100 + i, nextOpId: next)
        }
        #expect(snapshot.sync?.outbox == [
            SyncOp(opId: "op-4", hlc: "103:0:phone", kind: .task, id: "t1", fields: ["title": .string("Milk")]),
        ])
    }

    @Test func keystrokesInANewTaskFoldIntoItsCreate() {
        let store = Store(file: nil, clock: clock, newId: ids())
        let task = try! #require(store.addTask(NewTask(title: "")))
        for title in ["M", "Mi", "Mil", "Milk"] { store.updateTask(task.id, TaskPatch(title: title)) }
        let ops = store.snapshot.sync?.outbox.filter { $0.kind == .task } ?? []
        #expect(ops.count == 1)
        #expect(ops.first?.fields["title"] == .string("Milk"))
        #expect(ops.first?.fields["deleted"] == .bool(false))
    }

    @Test func aFirstSyncWithTheSameTasksAsTheServerQueuesNoTaskOps() throws {
        let task = TaskItem(id: "t1", title: "Milk", createdAt: 10)
        var snapshot = Snapshot.empty(now: 0)
        snapshot.tasks = [task]
        SyncEngine.ensure(&snapshot, deviceId: "phone", now: 0, timeZone: "UTC") { "zone" }
        #expect(snapshot.sync?.outbox.map(\.kind) == [.settings])

        let server = try JSONSerialization.jsonObject(with: JSONEncoder().encode(API.SyncSnapshot(
            tasks: [task, TaskItem(id: "t2", title: "Theirs", createdAt: 20)],
            projects: [],
            labels: [],
            settings: API.Settings(timeZone: "UTC", dictation: .native)
        )))
        let body = try JSONSerialization.data(withJSONObject: [
            "acked": ["zone"], "cursor": 2, "hlc": "30:0:server", "epoch": 0, "snapshot": server,
        ])
        #expect(SyncEngine.apply(&snapshot, response: body, now: 40) { "seed" } != nil)
        #expect(snapshot.sync?.outbox == [])
        #expect(snapshot.sync?.seed == false)
        #expect(snapshot.tasks.map(\.id) == ["t1", "t2"])
    }

    @Test func aFirstSyncQueuesOnlyWhatTheServerLacks() throws {
        var snapshot = Snapshot.empty(now: 0)
        snapshot.tasks = [TaskItem(id: "t1", title: "Milk", createdAt: 10), TaskItem(id: "mine", title: "Mine", createdAt: 15)]
        SyncEngine.ensure(&snapshot, deviceId: "phone", now: 0, timeZone: "UTC") { "zone" }
        let server = try JSONSerialization.jsonObject(with: JSONEncoder().encode(API.SyncSnapshot(
            tasks: [TaskItem(id: "t1", title: "Milk", createdAt: 10)],
            projects: [],
            labels: [],
            settings: API.Settings(timeZone: "UTC", dictation: .native)
        )))
        let body = try JSONSerialization.data(withJSONObject: [
            "acked": ["zone"], "cursor": 1, "hlc": "30:0:server", "epoch": 0, "snapshot": server,
        ])
        #expect(SyncEngine.apply(&snapshot, response: body, now: 40) { "seed" } != nil)
        let ops = try #require(snapshot.sync?.outbox)
        #expect(ops.map(\.id) == ["mine"])
        #expect(ops.first?.hlc == "40:0:phone")
        #expect(snapshot.tasks.map(\.id) == ["t1", "mine"])
    }

    @Test func aFirstSnapshotAfterAMissedWipeAdoptsTheServerAndUploadsNothing() throws {
        var snapshot = Snapshot.empty(now: 0)
        snapshot.tasks = [TaskItem(id: "stale", title: "Wiped elsewhere", createdAt: 10)]
        SyncEngine.ensure(&snapshot, deviceId: "phone", now: 0, timeZone: "UTC") { "zone" }
        let server = try JSONSerialization.jsonObject(with: JSONEncoder().encode(API.SyncSnapshot(
            tasks: [],
            projects: [],
            labels: [],
            settings: API.Settings(timeZone: "Europe/Paris", dictation: .elevenlabs)
        )))
        let body = try JSONSerialization.data(withJSONObject: [
            "acked": [], "cursor": 0, "hlc": "30:0:server", "epoch": 2, "snapshot": server,
        ])
        #expect(SyncEngine.apply(&snapshot, response: body, now: 40) { "seed" } != nil)
        #expect(snapshot.tasks.isEmpty)
        #expect(snapshot.sync?.outbox == [])
        #expect(snapshot.sync?.seed == false)
        #expect(snapshot.sync?.dictation == .elevenlabs)
        #expect(snapshot.sync?.timeZone == "UTC")
    }
}
