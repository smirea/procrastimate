import Core
import Foundation
import Testing

/// A store whose user has their own Errands project and a space Ann shared: her House project with Paint (editable)
/// and Fix roof (read only), and her urgent label.
@MainActor @Suite struct SpaceTests {
    let ann = Person(id: "ann", name: "Ann", kind: .human)

    static func annRows() -> StoredRows {
        var rows = StoredRows()
        rows.tasks = [
            Owned(owner: "ann", value: TaskItem(id: "paint", title: "Paint", projectId: "house", createdAt: 1)),
            Owned(owner: "ann", value: TaskItem(id: "roof", title: "Fix roof", projectId: "house", createdAt: 2)),
        ]
        rows.projects = [Owned(owner: "ann", value: Project(id: "house", name: "House", createdAt: 1))]
        rows.labels = [Owned(owner: "ann", value: Label(id: "urgent", name: "urgent", createdAt: 1))]
        rows.access = [
            access("task", "paint", .edit), access("task", "roof", .view),
            access("project", "house", .view), access("label", "urgent", .view),
        ]
        return rows
    }

    static func access(_ kind: API.AccessKind.RawValue, _ id: String, _ role: API.Role) -> Access {
        Access(id: "me:\(kind):\(id)", grantee: "me", owner: "ann", kind: API.AccessKind(rawValue: kind)!, entityId: id, role: role)
    }

    func store(_ rows: StoredRows = annRows()) -> (Store, WrittenRows) {
        let (store, written) = recordingStore(rows: rows)
        store.rememberPeople([ann])
        store.addProject("Errands")
        store.addLabel("home")
        written.batches = []
        return (store, written)
    }

    @Test func aSharedTaskChangesInItsSpaceAndWritesWithItsOwner() {
        let (store, written) = store()
        _ = store.completeTask("paint")

        #expect(store.task("paint")?.completedAt == pinned.epochMilliseconds)
        #expect(store.tasks.isEmpty)
        #expect(written.batches.map(\.owner) == ["ann"])
        #expect(written.writes == [patch(.task, "paint", ["completedAt": pinnedMs, "lastCompletedAt": pinnedMs])])
    }

    @Test func aCommentOnASharedTaskGoesToItsSpaceAndReadingItStaysAtHome() throws {
        let (store, written) = store()
        let mine = try #require(store.addComment("paint", "  Two coats ", by: "me"))
        #expect(store.addComment("roof", "Read only", by: "me") == nil)
        #expect(written.batches.map(\.owner) == ["ann"])
        #expect(written.writes == [put(.comment, mine.id, [
            "taskId": .string("paint"), "body": .string("Two coats"), "authorId": .string("me"), "createdAt": pinnedMs,
            "editedAt": .null,
        ])])

        let at = pinned.epochMilliseconds + 5
        var rows = Self.annRows()
        rows.projects += store.snapshot.projects.map { Owned(owner: "me", value: $0) }
        rows.labels += store.snapshot.labels.map { Owned(owner: "me", value: $0) }
        rows.comments = [
            Owned(owner: "ann", value: mine),
            Owned(owner: "ann", value: Comment(id: "c-ann", taskId: "paint", body: "Thanks", authorId: "ann", createdAt: at)),
        ]
        store.reload(Spaces(rows, me: "me"))
        #expect(store.comments(on: "paint").map(\.id) == [mine.id, "c-ann"])
        #expect(store.commentBadge("paint", me: "me") == CommentBadge(count: 2, unread: 1))

        store.markCommentsRead("paint", by: "me")
        #expect(store.commentBadge("paint", me: "me") == CommentBadge(count: 2, unread: 0))
        #expect(written.batches.last?.owner == "me")
        #expect(written.batches.last?.writes == [put(.read, "paint", ["readAt": .number(Double(at))])])
    }

    @Test func aNewTaskTakesItsParentsThenProjectsThenLabelsSpace() throws {
        let (store, written) = store()
        let errands = store.projects[0].id
        let home = store.labels[0].id

        let step = try #require(store.addTask(NewTask(title: "Buy brushes"), parentId: "paint"))
        let wall = try #require(store.addTask(NewTask(title: "Wash walls", projectId: "house", labelIds: [home])))
        let tagged = try #require(store.addTask(NewTask(title: "Call roofer", labelIds: [home, "urgent"])))
        let mine = try #require(store.addTask(NewTask(title: "Post office", projectId: errands, labelIds: ["urgent"])))

        #expect(store.space(ofTask: step.id) == .shared("ann"))
        #expect(store.space(ofTask: wall.id) == .shared("ann"))
        #expect(store.task(wall.id)?.labelIds == [])
        #expect(store.space(ofTask: tagged.id) == .shared("ann"))
        #expect(store.task(tagged.id)?.labelIds == ["urgent"])
        #expect(store.space(ofTask: mine.id) == .own)
        #expect(store.task(mine.id)?.labelIds == [])
        #expect(store.tasks.map(\.title) == ["Post office"])
        #expect(written.batches.map(\.owner) == ["ann", "ann", "ann", "me"])
        #expect(written.writes.map(\.id) == [step.id, wall.id, tagged.id, mine.id])
    }

    @Test func aReadOnlyTaskDoesNotChange() {
        let (store, written) = store()
        #expect(store.completeTask("roof") == nil)
        store.updateTask("roof", TaskPatch(title: "Ignore roof"))
        #expect(store.deleteTask("roof") == [])
        #expect(store.addTask(NewTask(title: "Ladder"), parentId: "roof") == nil)

        #expect(store.task("roof")?.title == "Fix roof")
        #expect(store.task("roof")?.completedAt == nil)
        #expect(written.batches == [])
    }

    @Test func aSharedTaskNeverMovesToAnotherSpace() {
        let (store, written) = store()
        let errands = store.projects[0].id
        store.updateTask("paint", TaskPatch(title: "Paint the hall", projectId: .some(errands), labelIds: [store.labels[0].id]))

        #expect(store.task("paint")?.title == "Paint the hall")
        #expect(store.task("paint")?.projectId == "house")
        #expect(store.task("paint")?.labelIds == [])
        #expect(store.projects(in: .shared("ann")).map(\.name) == ["House"])
        #expect(store.labels(in: .shared("ann")).map(\.name) == ["urgent"])
        #expect(written.writes == [patch(.task, "paint", ["title": .string("Paint the hall")])])
    }

    @Test func aGuestDoesNotRenameOrDeleteSharedProjectsAndLabels() {
        let (store, written) = store()
        store.renameProject("house", "Cabin")
        store.deleteProject("house")
        store.renameLabel("urgent", "later")
        store.deleteLabel("urgent")

        #expect(store.project("house")?.name == "House")
        #expect(store.label("urgent")?.name == "urgent")
        #expect(written.batches == [])
    }

    @Test func undoingADeletePutsTheTaskBackInItsSpace() {
        let (store, written) = store()
        let removed = store.deleteTask("paint")
        #expect(store.task("paint") == nil)
        store.undeleteTasks(removed)

        #expect(store.space(ofTask: "paint") == .shared("ann"))
        #expect(store.tasks.isEmpty)
        #expect(written.batches.map(\.owner) == ["ann", "ann"])
        #expect(written.writes.map(\.op) == [.delete, .put])
    }

    @Test func sharedWithMeListsProjectsLabelsAndLooseTasks() {
        let data = Snapshot(
            tasks: [
                TaskItem(id: "a", title: "Paint", projectId: "house", labelIds: ["urgent"], createdAt: 1),
                TaskItem(id: "b", title: "Book the vet", createdAt: 2),
                TaskItem(id: "c", parentId: "b", title: "Call first", createdAt: 3),
            ],
            projects: [Project(id: "pets", name: "Pets", order: 2, createdAt: 2), Project(id: "house", name: "House", order: 1, createdAt: 1)],
            labels: [Label(id: "urgent", name: "urgent", createdAt: 1)],
            settings: API.Settings()
        )
        let entries = Browse.sharedEntries([SharedSpace(id: "ann", owner: ann, data: data)])
        #expect(entries.map(\.name) == ["House", "Pets", "urgent", "Book the vet"])
        #expect(entries.map(\.kind) == [.project, .project, .label, .task])
        #expect(Set(entries.map(\.owner)) == [ann])
    }

    @Test func onlyAShareLinkOnTheAppsDomainNamesAToken() {
        func token(_ link: String) -> String? { SharedLinks.token(in: URL(string: link)!) }
        #expect(token("https://procrastimate.stf.lol/s/u1.abc") == "u1.abc")
        #expect(token("https://procrastimate.stf.lol/s/") == nil)
        #expect(token("https://procrastimate.stf.lol/s/u1.abc/more") == nil)
        #expect(token("https://example.com/s/u1.abc") == nil)
        #expect(token("procrastimate://task/abc") == nil)
    }

    @Test func aSpaceNoLongerSharedLeavesWithItsRows() {
        let (store, _) = store()
        var rows = StoredRows()
        rows.tasks = [Owned(owner: "bo", value: TaskItem(id: "bo-task", title: "Bo's", createdAt: 1))]
        store.rememberPeople([Person(id: "bo", name: "Bo", kind: .ai, ownerId: "me")])
        store.reload(Spaces(rows, me: "me"))

        #expect(store.task("paint") == nil)
        #expect(store.sharedSpaces.map(\.id) == ["bo"])
        #expect(store.owner(of: .shared("bo"))?.kind == .ai)
        #expect(store.owner(of: .shared("cy"))?.name == "Someone")
    }
}
