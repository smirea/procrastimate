import Core
import Foundation
import Testing

/// A store whose user has their own Errands project and a space Ann shared: her House project with Paint (editable)
/// and Fix roof (read only), and her urgent label.
@MainActor @Suite struct SpaceTests {
    let clock = AppClock.fixed(pinned, timeZone: TimeZone(identifier: "UTC")!)
    let ann = Person(id: "ann", name: "Ann", kind: .human)

    func store() -> Store {
        var next = 0
        let store = Store(file: nil, clock: clock) {
            next += 1
            return "id-\(next)"
        }
        store.addProject("Errands")
        store.addLabel("home")
        store.setSpaces([API.Space(id: "ann", owner: ann)])
        let shared = API.SyncSnapshot(
            tasks: [
                TaskItem(id: "paint", title: "Paint", projectId: "house", createdAt: 1),
                TaskItem(id: "roof", title: "Fix roof", projectId: "house", createdAt: 2),
            ],
            projects: [Project(id: "house", name: "House", createdAt: 1)],
            labels: [Label(id: "urgent", name: "urgent", createdAt: 1)],
            settings: API.Settings()
        )
        let applied = store.takeSyncResponse(
            .snapshot(.init(snapshot: shared, cursor: 7, hlc: "5:0:server", epoch: 0, scope: "h1", readOnly: ["roof"])),
            space: "ann"
        )
        #expect(applied)
        return store
    }

    func outbox(_ store: Store) -> [SyncOp] { store.snapshot.spaces["ann"]?.outbox ?? [] }
    func ownOutbox(_ store: Store) -> [SyncOp] { store.snapshot.sync?.outbox ?? [] }

    @Test func aSharedTaskChangesInItsSpaceAndQueuesThere() {
        let store = store()
        let ownBefore = ownOutbox(store).count
        _ = store.completeTask("paint")

        #expect(store.task("paint")?.completedAt == pinned.epochMilliseconds)
        #expect(store.tasks.isEmpty)
        #expect(ownOutbox(store).count == ownBefore)
        let op = try! #require(outbox(store).first)
        #expect(outbox(store).count == 1)
        #expect(op.kind == .task)
        #expect(op.id == "paint")
        #expect(op.fields["completedAt"] == .number(Double(pinned.epochMilliseconds)))
        #expect(store.snapshot.sync?.clock == op.hlc)
    }

    @Test func aNewTaskTakesItsParentsThenProjectsThenLabelsSpace() {
        let store = store()
        let errands = store.projects[0].id
        let home = store.labels[0].id

        let step = try! #require(store.addTask(NewTask(title: "Buy brushes"), parentId: "paint"))
        let wall = try! #require(store.addTask(NewTask(title: "Wash walls", projectId: "house", labelIds: [home])))
        let tagged = try! #require(store.addTask(NewTask(title: "Call roofer", labelIds: [home, "urgent"])))
        let mine = try! #require(store.addTask(NewTask(title: "Post office", projectId: errands, labelIds: ["urgent"])))

        #expect(store.space(ofTask: step.id) == .shared("ann"))
        #expect(store.space(ofTask: wall.id) == .shared("ann"))
        #expect(store.task(wall.id)?.labelIds == [])
        #expect(store.space(ofTask: tagged.id) == .shared("ann"))
        #expect(store.task(tagged.id)?.labelIds == ["urgent"])
        #expect(store.space(ofTask: mine.id) == .own)
        #expect(store.task(mine.id)?.labelIds == [])
        #expect(store.tasks.map(\.title) == ["Post office"])
        #expect(outbox(store).map(\.id) == [step.id, wall.id, tagged.id])
    }

    @Test func aReadOnlyTaskDoesNotChange() {
        let store = store()
        #expect(store.completeTask("roof") == nil)
        store.updateTask("roof", TaskPatch(title: "Ignore roof"))
        #expect(store.deleteTask("roof") == [])
        #expect(store.addTask(NewTask(title: "Ladder"), parentId: "roof") == nil)

        #expect(store.task("roof")?.title == "Fix roof")
        #expect(store.task("roof")?.completedAt == nil)
        #expect(outbox(store) == [])
    }

    @Test func aSharedTaskNeverMovesToAnotherSpace() {
        let store = store()
        let errands = store.projects[0].id
        store.updateTask("paint", TaskPatch(title: "Paint the hall", projectId: .some(errands), labelIds: [store.labels[0].id]))

        #expect(store.task("paint")?.title == "Paint the hall")
        #expect(store.task("paint")?.projectId == "house")
        #expect(store.task("paint")?.labelIds == [])
        #expect(store.projects(in: .shared("ann")).map(\.name) == ["House"])
        #expect(store.labels(in: .shared("ann")).map(\.name) == ["urgent"])
    }

    @Test func aGuestDoesNotRenameOrDeleteSharedProjectsAndLabels() {
        let store = store()
        store.renameProject("house", "Cabin")
        store.deleteProject("house")
        store.renameLabel("urgent", "later")
        store.deleteLabel("urgent")

        #expect(store.project("house")?.name == "House")
        #expect(store.label("urgent")?.name == "urgent")
        #expect(outbox(store) == [])
    }

    @Test func undoingADeletePutsTheTaskBackInItsSpace() {
        let store = store()
        let removed = store.deleteTask("paint")
        #expect(store.task("paint") == nil)
        store.undeleteTasks(removed)

        #expect(store.space(ofTask: "paint") == .shared("ann"))
        #expect(store.tasks.isEmpty)
        // The undo carries every field with a later clock, so it replaces the queued delete.
        #expect(outbox(store).map(\.fields["deleted"]) == [.bool(false)])
    }

    @Test func aSharedSpaceSyncsWithItsCursorScopeAndOutbox() throws {
        let store = store()
        let idle = try #require(try store.syncRequest(space: "ann"))
        #expect(idle.scope == "h1")
        _ = store.completeTask("paint")
        let request = try #require(try store.syncRequest(space: "ann"))
        #expect(request.cursor == 7)
        #expect(request.scope == "")
        #expect(request.ops.count == 1)

        let opId = outbox(store)[0].opId
        let applied = store.takeSyncResponse(
            .changes(.init(acked: [opId], cursor: 8, hlc: "9:0:server", epoch: 0, scope: "h2")),
            space: "ann"
        )
        #expect(applied)
        let section = try #require(store.snapshot.spaces["ann"])
        #expect(section.outbox == [])
        #expect(section.cursor == 8)
        #expect(section.scope == "h2")
        #expect(section.readOnly == ["roof"])
        #expect(store.task("paint")?.completedAt == pinned.epochMilliseconds)
    }

    @Test func sharedWithMeListsTheTargetsStillThere() {
        let section = SpaceSection(
            owner: ann,
            cursor: 1,
            targets: [
                API.ShareTarget(kind: .project, id: "house"),
                API.ShareTarget(kind: .task, id: "b"),
                API.ShareTarget(kind: .label, id: "gone"),
            ],
            tasks: [
                TaskItem(id: "a", title: "Paint", projectId: "house", labelIds: ["urgent"], createdAt: 1),
                TaskItem(id: "b", title: "Book the vet", projectId: "pets", createdAt: 2),
            ],
            projects: [Project(id: "house", name: "House", createdAt: 1), Project(id: "pets", name: "Pets", createdAt: 2)],
            labels: [Label(id: "urgent", name: "urgent", createdAt: 1)]
        )
        let entries = Browse.sharedEntries([(id: "ann", section: section)])
        #expect(entries.map(\.name) == ["House", "Book the vet"])
        #expect(entries.map(\.kind) == [.project, .task])

        var whole = section
        whole.targets = [API.ShareTarget(kind: .space, id: "")]
        #expect(Browse.sharedEntries([(id: "ann", section: whole)]).map(\.name) == ["House", "Pets"])
    }

    @Test func onlyAShareLinkOnTheAppsDomainNamesAToken() {
        func token(_ link: String) -> String? { SharedLinks.token(in: URL(string: link)!) }
        #expect(token("https://procrastimate.stf.lol/s/u1.abc") == "u1.abc")
        #expect(token("https://procrastimate.stf.lol/s/") == nil)
        #expect(token("https://procrastimate.stf.lol/s/u1.abc/more") == nil)
        #expect(token("https://example.com/s/u1.abc") == nil)
        #expect(token("procrastimate://task/abc") == nil)
    }

    @Test func spacesNoLongerSharedAreDropped() {
        let store = store()
        let bo = Person(id: "bo", name: "Bo", kind: .ai, ownerId: "me")
        store.setSpaces([API.Space(id: "bo", owner: bo)])

        #expect(store.task("paint") == nil)
        #expect(store.sharedSpaces.map(\.id) == ["bo"])
        #expect(store.person("ann")?.name == "Ann")
        #expect(store.person("bo")?.kind == .ai)
    }
}
