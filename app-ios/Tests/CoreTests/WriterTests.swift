import Core
import Foundation
import Testing

@MainActor @Suite struct WriterTests {
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
