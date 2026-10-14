import Core
import Foundation
import Testing

@MainActor @Suite struct MemoTaskTests {
    let clock = AppClock.fixed(pinned, timeZone: TimeZone(identifier: "UTC")!)
    let sourceKey = "voicememo:0b7c1f9e-6a59-4f0e-9d7e-3c2a1b0f9e8d:aaaaaaaa-0000-4000-8000-000000000001"

    /// The server creates memo tasks, so a phone only ever learns the key from a sync and must never send it back as null.
    @Test func aSyncedMemoTaskKeepsItsSourceKeyThroughEditsAndReload() async throws {
        let file = SnapshotFile(url: FileManager.default.temporaryDirectory
            .appending(path: "memo-tests-\(UUID().uuidString)", directoryHint: .isDirectory)
            .appending(path: "procrastimate.json"))
        let store = Store(file: file, clock: clock)
        let body = Data(#"""
        {"acked":[],"cursor":1,"hlc":"2:0:server","epoch":0,"changes":[{"seq":1,"opId":"\#(sourceKey)","kind":"task","id":"memo-task","fields":{"deleted":false,"parentId":null,"order":0,"title":"Call the plumber","notes":"","projectId":null,"labelIds":[],"due":null,"recurrence":null,"priority":4,"reminders":[],"location":null,"event":null,"createdAt":1,"completedAt":null,"sourceKey":"\#(sourceKey)"}}]}
        """#.utf8)
        #expect(store.takeSyncResponse(try JSONDecoder().decode(API.SyncResponse.self, from: body)))
        store.updateTask("memo-task", TaskPatch(title: "Call the plumber today"))
        await store.flush()

        let reloaded = Store(file: file, clock: clock)
        let task = try #require(reloaded.task("memo-task"))
        #expect(task.sourceKey == sourceKey)
        #expect(task.memoSource?.memoId == "0b7c1f9e-6a59-4f0e-9d7e-3c2a1b0f9e8d")
        let edit = try #require(reloaded.snapshot.sync?.outbox.last)
        #expect(edit.fields == ["title": .string("Call the plumber today")])
    }

    @Test func theMemoLinkOpensTheEntry() {
        #expect(MemoTasks.memoURL("0b7c1f9e-6a59-4f0e-9d7e-3c2a1b0f9e8d").absoluteString
            == "myvoicememo://entry?id=0b7c1f9e-6a59-4f0e-9d7e-3c2a1b0f9e8d")
    }
}
