import Core
import Foundation
import Testing

@MainActor @Suite struct StoreTests {
    @Test func commandsWriteOnlyTheRowsTheyChangeInOrder() throws {
        let (store, written) = recordingStore()
        store.addTask(NewTask(title: "Buy milk"))
        let rent = try #require(store.addTask(NewTask(title: "Pay rent", due: Due(date: "2026-10-14", time: nil))))
        _ = store.completeTask(rent.id)

        #expect(written.batches.map(\.version) == [1, 2, 3])
        #expect(written.batches.map(\.owner) == ["me", "me", "me"])
        #expect(written.writes.map(\.op) == [.put, .put, .patch])
        #expect(written.writes[0].values?["title"] == .string("Buy milk"))
        #expect(written.writes[0].values?["sourceKey"] == .null)
        #expect(written.writes[0].values?["id"] == nil)
        #expect(written.writes[2] == patch(.task, "id-2", ["completedAt": pinnedMs, "lastCompletedAt": pinnedMs]))
    }

    @Test func aReloadReadBeforeTheLatestWriteLandedWaitsForTheWriter() {
        let store = Store(me: "me", clock: .fixed(pinned, timeZone: TimeZone(identifier: "UTC")!), newId: sequentialIds())
        var batches: [RowBatch] = []
        store.writer = { batches.append($0) }
        store.addTask(NewTask(title: "Buy milk"))

        store.reload(Spaces())
        #expect(store.tasks.map(\.title) == ["Buy milk"])
        #expect(store.written(1))
        #expect(!store.written(1))

        var rows = StoredRows()
        rows.tasks = [Owned(owner: "me", value: TaskItem(id: "id-1", title: "Buy oat milk", createdAt: 1))]
        store.reload(Spaces(rows, me: "me"))
        #expect(store.tasks.map(\.title) == ["Buy oat milk"])
        #expect(batches.count == 1)
    }

    @Test func rowsGroupIntoTheOwnSpaceAndOneSpacePerOwner() {
        var rows = StoredRows()
        rows.tasks = [
            Owned(owner: "ann", value: TaskItem(id: "fence", title: "Fence", createdAt: 3)),
            Owned(owner: "me", value: TaskItem(id: "b", title: "Mine later", createdAt: 2)),
            Owned(owner: "me", value: TaskItem(id: "a", title: "Mine", createdAt: 1)),
        ]
        rows.settings = [Owned(owner: "me", value: API.Settings(timeZone: "Europe/Berlin", dictation: .elevenlabs))]
        rows.access = [Access(id: "me:task:fence", grantee: "me", owner: "ann", kind: .task, entityId: "fence", role: .view)]
        let (store, _) = recordingStore(rows: rows)
        store.rememberPeople([Person(id: "ann", name: "Ann", kind: .human)])

        #expect(store.tasks.map(\.id) == ["a", "b"])
        #expect(store.allTasks.map(\.id) == ["a", "b", "fence"])
        #expect(store.space(ofTask: "fence") == .shared("ann"))
        #expect(store.sharedSpaces.map(\.owner.name) == ["Ann"])
        #expect(store.isReadOnly("fence"))
        #expect(!store.isReadOnly("a"))
        #expect(store.dictation == .elevenlabs)
    }

    @Test func aLabelUndoneBeforeItsDeletedTaskComesBackOnIt() throws {
        let (store, _) = recordingStore()
        let calls = store.addLabel("calls")
        let task = try #require(store.addTask(NewTask(title: "Call bank", labelIds: [calls.id])))
        let label = store.offerUndo(.delete(.init(deleted: try #require(store.deleteLabel(calls.id)))))
        let removed = store.deleteTask(task.id)
        let taskUndo = store.offerUndo(.delete(.init(deleted: Deleted(tasks: removed))))

        store.undo(label)
        #expect(store.task(task.id) == nil)
        store.undo(taskUndo)
        #expect(store.task(task.id)?.labelIds == [calls.id])
        #expect(store.labels.map(\.name) == ["calls"])
    }

    @Test func deleteAllDeletesEveryOwnRowButKeepsTheSettingsAndOthersComments() {
        var rows = StoredRows()
        rows.tasks = [Owned(owner: "me", value: TaskItem(id: "t", title: "Mine", createdAt: 1))]
        rows.projects = [Owned(owner: "me", value: Project(id: "p", name: "Home", createdAt: 1))]
        rows.tasks.append(Owned(owner: "ann", value: TaskItem(id: "fence", title: "Fence", createdAt: 1)))
        rows.comments = [
            Owned(owner: "me", value: Comment(id: "c-me", taskId: "t", body: "Mine", authorId: "me", createdAt: 1)),
            Owned(owner: "me", value: Comment(id: "c-ann", taskId: "t", body: "Ann's", authorId: "ann", createdAt: 2)),
        ]
        let (store, written) = recordingStore(rows: rows)
        store.deleteAll()
        #expect(written.writes == [
            RowWrite(op: .delete, kind: .project, id: "p"),
            RowWrite(op: .delete, kind: .task, id: "t"),
            RowWrite(op: .delete, kind: .comment, id: "c-me"),
        ])
        #expect(store.task("fence") != nil)
    }

    @Test func settingsChangesPatchTheSettingsRow() {
        let (store, written) = recordingStore(rows: settingsRows())
        store.setDictation(.elevenlabs)
        store.setDictation(.elevenlabs)
        store.setQuickAddButtons([.date, .labels])
        store.noteTimeZone("Europe/Berlin")
        #expect(written.writes == [
            patch(.settings, "settings", ["dictation": .string("elevenlabs")]),
            patch(.settings, "settings", ["quickAddButtons": .array([.string("date"), .string("labels")])]),
            patch(.settings, "settings", ["timeZone": .string("Europe/Berlin")]),
        ])
    }

    @Test func switchingUsersStartsEmpty() {
        var rows = StoredRows()
        rows.tasks = [Owned(owner: "me", value: TaskItem(id: "t", title: "Mine", createdAt: 1))]
        let (store, written) = recordingStore(rows: rows)
        store.switchUser(to: "bo")
        #expect(store.me == "bo")
        #expect(store.tasks.isEmpty)
        store.addTask(NewTask(title: "Bo's"))
        #expect(written.batches.map(\.owner) == ["bo"])
    }
}
