import Core
import Foundation
import Testing

@MainActor @Suite struct MemoTaskTests {
    let clock = AppClock.fixed(pinned, timeZone: TimeZone(identifier: "UTC")!)
    let sourceKey = "voicememo:0b7c1f9e-6a59-4f0e-9d7e-3c2a1b0f9e8d:aaaaaaaa-0000-4000-8000-000000000001"

    /// The server creates memo tasks, so a phone only ever learns the key from a sync and must never send it back as null.
    @Test func aSyncedMemoTaskKeepsItsSourceKeyThroughEdits() throws {
        var rows = StoredRows()
        rows.tasks = [Owned(owner: "me", value: TaskItem(id: "memo-task", title: "Call the plumber", createdAt: 1, sourceKey: sourceKey))]
        let (store, written) = recordingStore(rows: rows, clock: clock)
        store.updateTask("memo-task", TaskPatch(title: "Call the plumber today"))

        let task = try #require(store.task("memo-task"))
        #expect(task.sourceKey == sourceKey)
        #expect(task.memoSource?.memoId == "0b7c1f9e-6a59-4f0e-9d7e-3c2a1b0f9e8d")
        #expect(written.writes == [patch(.task, "memo-task", ["title": .string("Call the plumber today")])])
    }

}
