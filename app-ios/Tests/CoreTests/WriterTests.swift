import Core
import Foundation
import Testing

@MainActor @Suite struct WriterTests {
    @Test func aStoreThatDoesNotKnowItsOwnerHoldsEveryWriteUntilItDoes() {
        let (store, written) = recordingStore(me: nil)
        store.addTask(NewTask(title: "Buy milk"))
        store.addProject("Home")
        #expect(store.tasks.map(\.title) == ["Buy milk"])
        #expect(written.batches.isEmpty)

        store.adopt("u1")
        #expect(store.me == "u1")
        #expect(store.tasks.map(\.title) == ["Buy milk"])
        #expect(written.batches.map(\.owner) == ["u1", "u1"])
        #expect(written.batches.map(\.version) == [1, 2])
        #expect(written.writes.map(\.kind) == [.task, .project])

        store.addTask(NewTask(title: "Pay rent"))
        #expect(written.batches.map(\.owner) == ["u1", "u1", "u1"])
    }

    @Test func aSettingsChangeBeforeTheRowArrivesStaysInMemoryAndPatchesTheRowOnceItDoes() {
        let (store, written) = recordingStore()
        store.setDictation(.elevenlabs)
        store.noteTimeZone("Europe/Berlin")
        #expect(store.dictation == .elevenlabs)
        #expect(written.writes == [])

        store.reload(Spaces(StoredRows(), me: "me"))
        #expect(store.dictation == .elevenlabs)
        #expect(written.writes == [])

        store.reload(Spaces(settingsRows(API.Settings(timeZone: "Europe/Berlin", quickAddButtons: [.labels])), me: "me"))
        #expect(written.writes == [patch(.settings, "settings", ["dictation": .string("elevenlabs")])])
        #expect(store.snapshot.settings == API.Settings(timeZone: "Europe/Berlin", dictation: .elevenlabs, quickAddButtons: [.labels]))

        store.reload(Spaces(settingsRows(API.Settings(timeZone: "Europe/Berlin", dictation: .elevenlabs, quickAddButtons: [.labels])), me: "me"))
        #expect(written.writes.count == 1)
    }

    @Test func savedWaitsUntilTheWriterFinishedEveryCommitMadeBeforeIt() async {
        let store = Store(me: "me", clock: .fixed(pinned, timeZone: TimeZone(identifier: "UTC")!), newId: sequentialIds())
        store.writer = { _ in }
        store.addTask(NewTask(title: "Buy milk"))
        store.addTask(NewTask(title: "Pay rent"))
        let progress = Progress()
        let waiter = Task { @MainActor in
            await store.saved()
            progress.saved = true
        }
        for _ in 0 ..< 10 { await Task.yield() }
        _ = store.written(1)
        for _ in 0 ..< 10 { await Task.yield() }
        #expect(!progress.saved)

        _ = store.written(2)
        await waiter.value
        #expect(progress.saved)
    }

    @MainActor final class Progress {
        var saved = false
    }
}
