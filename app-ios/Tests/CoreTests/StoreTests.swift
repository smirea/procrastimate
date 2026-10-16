import Core
import Foundation
import Testing

@MainActor @Suite struct StoreTests {
    let clock = AppClock.fixed(pinned, timeZone: TimeZone(identifier: "UTC")!)

    func tempFile() -> SnapshotFile {
        SnapshotFile(url: FileManager.default.temporaryDirectory
            .appending(path: "store-tests-\(UUID().uuidString)", directoryHint: .isDirectory)
            .appending(path: "procrastimate.json"))
    }

    func ids() -> () -> String {
        var next = 0
        return {
            next += 1
            return "id-\(next)"
        }
    }

    @Test func aFreshStoreIsEmptyAndReadyToSync() {
        let store = Store(file: tempFile(), clock: clock)
        #expect(store.tasks.isEmpty)
        let sync = try! #require(store.snapshot.sync)
        #expect(sync.cursor == 0)
        #expect(sync.reset == false)
        #expect(sync.epoch == 0)
        #expect(sync.outbox.contains { $0.kind == .settings })
        #expect(store.snapshot.remindersCheckedAt == pinned.epochMilliseconds)
    }

    @Test func aBurstOfCommandsIsWrittenAndReloads() async throws {
        let file = tempFile()
        let store = Store(file: file, clock: clock, newId: ids())
        store.addTask(NewTask(title: "Buy milk"))
        let rent = try #require(store.addTask(NewTask(title: "Pay rent", due: Due(date: "2026-10-14", time: nil))))
        _ = store.completeTask(rent.id)
        await store.flush()

        let reloaded = Store(file: file, clock: clock)
        #expect(reloaded.snapshot == store.snapshot)
        #expect(reloaded.tasks.map(\.title) == ["Buy milk", "Pay rent"])
        #expect(reloaded.task(rent.id)?.completedAt == pinned.epochMilliseconds)

        let json = try #require(file.read())
        let object = try #require(try JSONSerialization.jsonObject(with: json) as? [String: Any])
        #expect(Set(object.keys) == ["tasks", "projects", "sections", "labels", "remindersCheckedAt", "sync", "spaces", "people"])
    }

    @Test func commitKeepsTasksInSyncOrder() {
        let store = Store(file: nil, clock: clock)
        let late = TaskItem(id: "a", title: "Late", createdAt: 20)
        let early = TaskItem(id: "c", title: "Early", createdAt: 10)
        let tie = TaskItem(id: "b", title: "Tie", createdAt: 10)
        store.commit(StoreData(tasks: [late, early, tie]))
        #expect(store.tasks.map(\.id) == ["b", "c", "a"])
    }

    @Test func undoPutsBackACompletionAndADelete() {
        let store = Store(file: nil, clock: clock, newId: ids())
        let task = try! #require(store.addTask(NewTask(title: "Standup", due: Due(date: "2026-10-14", time: "09:00"), recurrence: Recurrence(interval: 1, unit: .day))))
        let completion = try! #require(store.completeTask(task.id))
        #expect(completion.next == Due(date: "2026-10-15", time: "09:00"))
        store.restoreCompletion(completion.previous)
        #expect(store.task(task.id)?.due == Due(date: "2026-10-14", time: "09:00"))

        let removed = store.deleteTask(task.id)
        #expect(store.tasks.isEmpty)
        store.undeleteTasks(removed)
        #expect(store.tasks.map(\.id) == [task.id])
    }

    @Test func anInvalidFileStartsEmpty() async throws {
        let file = tempFile()
        try FileManager.default.createDirectory(at: file.url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("not json".utf8).write(to: file.url)
        let store = Store(file: file, clock: clock)
        #expect(store.tasks.isEmpty)
    }
}
