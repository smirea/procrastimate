import Foundation
import Observation

/// The app's one store: the stored document in memory, with every command from `StoreRules`. Each command applies at
/// once and goes through `commit`, which keeps tasks in their sync order and schedules one coalesced write, so the
/// sync client can diff a commit into its outbox later without touching the commands.
@MainActor @Observable
public final class Store {
    public private(set) var snapshot: Snapshot
    /// Bumps when a local command changes the document, so sync can wait a moment and ignore server applies.
    public private(set) var revision = 0

    @ObservationIgnored private let file: SnapshotFile?
    @ObservationIgnored private let clock: AppClock
    @ObservationIgnored private let newId: () -> String
    @ObservationIgnored private var version = 0
    @ObservationIgnored private var pendingWrite: Task<Void, Never>?
    /// Where each deleted task lived, so undo puts it back in the same space.
    @ObservationIgnored private var deletedFrom: [String: SpaceKey] = [:]

    public init(file: SnapshotFile?, clock: AppClock, newId: @escaping () -> String = { UUID().uuidString.lowercased() }) {
        self.file = file
        self.clock = clock
        self.newId = newId
        let now = clock.now.epochMilliseconds
        snapshot = file?.read().map { Snapshot.load($0, now: now) } ?? .empty(now: now)
        let hadSync = snapshot.sync != nil
        SyncEngine.ensure(
            &snapshot,
            deviceId: UUID().uuidString.lowercased(),
            now: now,
            timeZone: clock.timeZone.identifier,
            nextOpId: newId
        )
        if !hadSync { scheduleWrite() }
    }

    /// The user's own tasks, projects, and labels, which the personal views (Inbox, Today, No date, places, search) show.
    public var tasks: [TaskItem] { snapshot.tasks }
    public var projects: [Project] { snapshot.projects }
    public var labels: [Label] { snapshot.labels }
    public var sections: [ProjectSection] { snapshot.sections }

    /// Own data, then each shared space's, for subtasks, details, and shared project and label screens.
    public var allTasks: [TaskItem] { snapshot.tasks + sharedSpaces.flatMap(\.section.tasks) }
    public var allProjects: [Project] { snapshot.projects + sharedSpaces.flatMap(\.section.projects) }
    public var allLabels: [Label] { snapshot.labels + sharedSpaces.flatMap(\.section.labels) }
    public var allSections: [ProjectSection] { snapshot.sections + sharedSpaces.flatMap(\.section.sections) }

    /// Shared spaces by owner name, with their ids.
    public var sharedSpaces: [(id: String, section: SpaceSection)] {
        snapshot.spaces.map { ($0.key, $0.value) }.sorted { ($0.section.owner.name, $0.id) < ($1.section.owner.name, $1.id) }
    }

    public func task(_ id: String) -> TaskItem? {
        snapshot.tasks.first { $0.id == id }
            ?? snapshot.spaces.values.lazy.compactMap { $0.tasks.first { $0.id == id } }.first
    }

    public func project(_ id: String?) -> Project? {
        guard let id else { return nil }
        return snapshot.projects.first { $0.id == id }
            ?? snapshot.spaces.values.lazy.compactMap { $0.projects.first { $0.id == id } }.first
    }

    public func section(_ id: String?) -> ProjectSection? {
        guard let id else { return nil }
        return snapshot.sections.first { $0.id == id }
            ?? snapshot.spaces.values.lazy.compactMap { $0.sections.first { $0.id == id } }.first
    }

    /// A project's sections in their order, from whichever space holds the project.
    public func sections(of projectId: String) -> [ProjectSection] { StoreRules.sectionsOf(allSections, projectId) }

    public func label(_ id: String) -> Label? {
        snapshot.labels.first { $0.id == id }
            ?? snapshot.spaces.values.lazy.compactMap { $0.labels.first { $0.id == id } }.first
    }

    /// A task's labels in the order they were added, skipping any that were deleted.
    public func labels(of task: TaskItem) -> [Label] { task.labelIds.compactMap(label) }

    public func space(ofTask id: String) -> SpaceKey? { space { $0.tasks.contains { $0.id == id } } }
    public func space(ofProject id: String) -> SpaceKey? { space { $0.projects.contains { $0.id == id } } }
    public func space(ofLabel id: String) -> SpaceKey? { space { $0.labels.contains { $0.id == id } } }

    private func space(where holds: (StoreData) -> Bool) -> SpaceKey? {
        if holds(snapshot.data) { return .own }
        return snapshot.spaces.keys.first { holds(data(in: .shared($0))) }.map { .shared($0) }
    }

    public func data(in space: SpaceKey) -> StoreData {
        switch space {
        case .own: return snapshot.data
        case let .shared(id):
            guard let section = snapshot.spaces[id] else { return StoreData() }
            return StoreData(
                tasks: section.tasks,
                projects: section.projects,
                sections: section.sections,
                labels: section.labels
            )
        }
    }

    /// The projects and labels a task in this space can pick. A task never leaves its space.
    public func projects(in space: SpaceKey) -> [Project] { data(in: space).projects }
    public func labels(in space: SpaceKey) -> [Label] { data(in: space).labels }

    /// The owner of a shared space, or nil for the user's own.
    public func owner(of space: SpaceKey) -> Person? {
        space.query.flatMap { snapshot.spaces[$0]?.owner }
    }

    /// A shared task this user may see but not change.
    public func isReadOnly(_ taskID: String) -> Bool {
        snapshot.spaces.values.contains { $0.readOnly.contains(taskID) }
    }

    public func person(_ id: String?) -> Person? {
        guard let id else { return nil }
        return snapshot.people.first { $0.id == id }
    }

    public func commit(_ next: StoreData) { commit(next, in: .own) }

    /// Commits into the space the command ran on, so its ops queue in that space's outbox.
    public func commit(_ next: StoreData, in space: SpaceKey) {
        var data = next
        data.tasks = StoreRules.sortTasks(next.tasks)
        let now = clock.now.epochMilliseconds
        switch space {
        case .own:
            let before = snapshot.data
            snapshot.data = data
            SyncEngine.record(&snapshot, before: before, after: data, now: now, nextOpId: newId)
        case let .shared(id):
            let recorded: Void? = SyncEngine.inSpace(&snapshot, id) { lens in
                let before = lens.data
                lens.data = data
                SyncEngine.record(&lens, before: before, after: data, now: now, nextOpId: newId)
            }
            guard recorded != nil else { return }
        }
        revision += 1
        scheduleWrite()
    }

    /// Drops local tasks for a different user without recording deletes, so they are not uploaded.
    public func switchUser() {
        SyncEngine.replaceForNewUser(&snapshot)
        revision += 1
        scheduleWrite()
    }

    /// Empties tasks, projects, sections, and labels here, and asks the next sync to wipe them on the server.
    public func deleteAll() {
        SyncEngine.deleteAll(&snapshot)
        revision += 1
        scheduleWrite()
    }

    /// The body of `POST /api/sync`.
    public func syncRequest() throws -> API.SyncRequest? { try SyncEngine.request(snapshot) }

    /// Applies one sync response onto the document.
    public func takeSyncResponse(_ response: API.SyncResponse) -> Bool {
        let applied = SyncEngine.apply(&snapshot, response: response, now: clock.now.epochMilliseconds, nextOpId: newId)
        if applied { scheduleWrite() }
        return applied
    }

    /// The body of `POST /api/sync?space=<id>` for a shared space.
    public func syncRequest(space id: String) throws -> API.SyncRequest? { try SyncEngine.request(snapshot, space: id) }

    public func takeSyncResponse(_ response: API.SyncResponse, space id: String) -> Bool {
        let applied = SyncEngine.apply(
            &snapshot, space: id, response: response, now: clock.now.epochMilliseconds, nextOpId: newId
        )
        if applied { scheduleWrite() }
        return applied
    }

    /// Matches the sections to the spaces the server says are shared with this user.
    public func setSpaces(_ spaces: [API.Space]) {
        var next = snapshot
        SyncEngine.setSpaces(&next, spaces)
        guard next != snapshot else { return }
        snapshot = next
        scheduleWrite()
    }

    /// Forgets a space whose sync was refused, as when its last share was revoked.
    public func dropSpace(_ id: String) {
        guard snapshot.spaces[id] != nil else { return }
        snapshot.spaces[id] = nil
        scheduleWrite()
    }

    public func rememberPeople(_ people: [Person]) {
        var next = snapshot
        SyncEngine.rememberPeople(&next, people)
        guard next != snapshot else { return }
        snapshot = next
        scheduleWrite()
    }

    /// Keeps the outbox when the server stores this install under a different id.
    public func adoptDevice(_ deviceId: String) {
        guard var sync = snapshot.sync, sync.deviceId != deviceId else { return }
        sync.deviceId = deviceId
        snapshot.sync = sync
        scheduleWrite()
    }

    /// The dictation choice last applied here, including one that arrived from another device.
    public var dictation: DictationChoice { snapshot.sync?.dictation ?? .native }

    /// Remembers the choice and queues it for sync.
    public func setDictation(_ choice: DictationChoice) {
        guard dictation != choice else { return }
        SyncEngine.setDictation(&snapshot, choice, now: clock.now.epochMilliseconds, nextOpId: newId)
        scheduleWrite()
    }

    /// The quick add buttons pinned to the chip row, including a change from another device.
    public var quickAddButtons: [QuickAddButton] { snapshot.sync?.quickAddButtons ?? API.Settings().quickAddButtons }

    public func setQuickAddButtons(_ buttons: [QuickAddButton]) {
        guard quickAddButtons != buttons else { return }
        SyncEngine.setQuickAddButtons(&snapshot, buttons, now: clock.now.epochMilliseconds, nextOpId: newId)
        scheduleWrite()
    }

    /// Writes this device's zone when it has moved since the last sync.
    public func noteTimeZone(_ timeZone: String) {
        guard snapshot.sync?.timeZone != timeZone else { return }
        SyncEngine.noteTimeZone(&snapshot, timeZone, now: clock.now.epochMilliseconds, nextOpId: newId)
        scheduleWrite()
    }

    /// Waits for the latest commit to reach the file.
    public func flush() async {
        await pendingWrite?.value
    }

    private func scheduleWrite() {
        version += 1
        guard let file, pendingWrite == nil else { return }
        pendingWrite = Task {
            await Task.yield()
            var written: Int
            repeat {
                written = version
                await file.write(snapshot, version: written)
            } while written != version
            pendingWrite = nil
        }
    }

    private func creation() -> Creation { Creation(id: newId(), now: clock.now.epochMilliseconds) }

    /// Adds the task to its parent's space, else its project's, else the space of a shared label it carries (as from a
    /// shared label's screen), else the user's own. A project or label from another space is dropped from it, and a
    /// read-only parent takes no subtasks.
    @discardableResult
    public func addTask(_ input: NewTask, parentId: String? = nil) -> TaskItem? {
        if let parentId, isReadOnly(parentId) { return nil }
        let space = parentId.flatMap { space(ofTask: $0) }
            ?? input.projectId.flatMap { space(ofProject: $0) }
            ?? input.labelIds.lazy.compactMap { self.space(ofLabel: $0) }.first { $0 != .own }
            ?? .own
        let data = data(in: space)
        var input = input
        input.projectId = input.projectId.flatMap { id in data.projects.contains { $0.id == id } ? id : nil }
        input.sectionId = input.sectionId.flatMap { id in data.sections.contains { $0.id == id } ? id : nil }
        input.labelIds = input.labelIds.filter { id in data.labels.contains { $0.id == id } }
        let (next, task) = StoreRules.addTask(data, input, parentId: parentId, creation())
        commit(next, in: space)
        return task
    }

    /// Runs a task command on the space that holds the task. A read-only task does not change.
    private func edit(_ taskID: String, _ command: (StoreData) -> StoreData) {
        guard let space = space(ofTask: taskID), !isReadOnly(taskID) else { return }
        commit(command(data(in: space)), in: space)
    }

    /// The zone lists resolve event times in.
    public var timeZone: TimeZone { clock.timeZone }

    public func updateTask(_ id: String, _ patch: TaskPatch) {
        guard let space = space(ofTask: id) else { return }
        let data = data(in: space)
        var patch = patch
        if case let .some(.some(projectId)) = patch.projectId, !data.projects.contains(where: { $0.id == projectId }) {
            patch.projectId = nil
        }
        if case let .some(.some(sectionId)) = patch.sectionId, !data.sections.contains(where: { $0.id == sectionId }) {
            patch.sectionId = nil
        }
        patch.labelIds = patch.labelIds?.filter { id in data.labels.contains { $0.id == id } }
        edit(id) { StoreRules.updateTask($0, id, patch) }
    }

    public func completeTask(_ id: String) -> Completion? {
        guard let space = space(ofTask: id), !isReadOnly(id), let result = StoreRules.completeTask(
            data(in: space), id, today: clock.today, now: clock.now.epochMilliseconds, in: clock.timeZone
        ) else { return nil }
        commit(result.data, in: space)
        return result.completion
    }

    public func reopenTask(_ id: String) {
        edit(id) { StoreRules.reopenTask($0, id) }
    }

    public func restoreCompletion(_ previous: [CompletionState]) {
        guard let first = previous.first else { return }
        edit(first.id) { StoreRules.restoreCompletion($0, previous) }
    }

    public func moveSubtask(_ id: String, to index: Int) {
        edit(id) { StoreRules.moveSubtask($0, id, index) }
    }

    /// Turns the task's subtasks into tasks of their own, and returns them as they were for undo. Only in the user's own
    /// space: moving a subtask up can carry it out of what a share grants, and the server would refuse the edit.
    @discardableResult
    public func explodeSubtasks(_ id: String, _ method: ExplodeMethod) -> [ExplodedState] {
        var previous: [ExplodedState] = []
        guard space(ofTask: id) == .own else { return previous }
        edit(id) { data in
            let result = StoreRules.explodeSubtasks(data, id, method)
            previous = result.previous
            return result.data
        }
        return previous
    }

    public func restoreExploded(_ previous: [ExplodedState]) {
        guard let first = previous.first else { return }
        edit(first.id) { StoreRules.restoreExploded($0, previous) }
    }

    /// Deletes the task with every subtask under it, and returns them for undo.
    public func deleteTask(_ id: String) -> [TaskItem] {
        guard let space = space(ofTask: id), !isReadOnly(id) else { return [] }
        let (data, removed) = StoreRules.deleteTask(data(in: space), id)
        commit(data, in: space)
        for task in removed { deletedFrom[task.id] = space }
        return removed
    }

    public func undeleteTasks(_ removed: [TaskItem]) {
        guard let first = removed.first else { return }
        let space = deletedFrom[first.id] ?? .own
        commit(StoreRules.undeleteTasks(data(in: space), removed), in: space)
    }

    @discardableResult
    public func addProject(_ name: String) -> Project {
        let (data, project) = StoreRules.addProject(snapshot.data, name, creation())
        commit(data)
        return project
    }

    /// Guests never write another space's projects or labels, so these change only the user's own.
    public func renameProject(_ id: String, _ name: String) {
        guard space(ofProject: id) == .own else { return }
        commit(StoreRules.renameProject(snapshot.data, id, name))
    }

    public func deleteProject(_ id: String) {
        guard space(ofProject: id) == .own else { return }
        commit(StoreRules.deleteProject(snapshot.data, id))
    }

    /// Sections, like projects, are only ever written in the user's own space.
    @discardableResult
    public func addSection(_ projectId: String, _ name: String) -> ProjectSection? {
        guard space(ofProject: projectId) == .own else { return nil }
        let (data, section) = StoreRules.addSection(snapshot.data, projectId, name, creation())
        commit(data)
        return section
    }

    public func renameSection(_ id: String, _ name: String) {
        guard snapshot.sections.contains(where: { $0.id == id }) else { return }
        commit(StoreRules.renameSection(snapshot.data, id, name))
    }

    public func moveSection(_ id: String, to index: Int) {
        guard snapshot.sections.contains(where: { $0.id == id }) else { return }
        commit(StoreRules.moveSection(snapshot.data, id, index))
    }

    public func deleteSection(_ id: String) {
        guard snapshot.sections.contains(where: { $0.id == id }) else { return }
        commit(StoreRules.deleteSection(snapshot.data, id))
    }

    @discardableResult
    public func addLabel(_ name: String) -> Label {
        let (data, label) = StoreRules.addLabel(snapshot.data, name, creation())
        commit(data)
        return label
    }

    public func renameLabel(_ id: String, _ name: String) {
        guard space(ofLabel: id) == .own else { return }
        commit(StoreRules.renameLabel(snapshot.data, id, name))
    }

    public func deleteLabel(_ id: String) {
        guard space(ofLabel: id) == .own else { return }
        commit(StoreRules.deleteLabel(snapshot.data, id))
    }

    /// Adds a Todoist backup in one command and one write, skipping tasks an earlier import already added.
    public func importTodoist(_ backup: Todoist.Backup) -> Todoist.Summary {
        let (data, summary) = Todoist.mergeBackup(snapshot.data, backup, newId: newId, now: clock.now.epochMilliseconds)
        commit(data)
        return summary
    }

    /// Device-local, so it changes the document without being a synced change.
    public func markRemindersChecked(at time: Int) {
        snapshot.remindersCheckedAt = time
        scheduleWrite()
    }
}

/// The stored document's file. Writes are atomic, run off the main actor, and skip a snapshot older than one already
/// written, so a burst of commits ends with the newest on disk.
public actor SnapshotFile {
    public nonisolated let url: URL
    private var written = 0

    public init(url: URL) {
        self.url = url
    }

    public nonisolated func read() -> Data? {
        try? Data(contentsOf: url)
    }

    func write(_ snapshot: Snapshot, version: Int) {
        guard version > written else { return }
        do {
            let data = try snapshot.encoded()
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try data.write(to: url, options: .atomic)
            written = version
        } catch {
            assertionFailure("Could not save the store: \(error)")
        }
    }
}
