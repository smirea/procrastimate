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

    public var tasks: [TaskItem] { snapshot.tasks }
    public var projects: [Project] { snapshot.projects }
    public var labels: [Label] { snapshot.labels }

    public func task(_ id: String) -> TaskItem? { snapshot.tasks.first { $0.id == id } }
    public func project(_ id: String?) -> Project? { id.flatMap { id in snapshot.projects.first { $0.id == id } } }
    public func label(_ id: String) -> Label? { snapshot.labels.first { $0.id == id } }

    /// A task's labels in the order they were added, skipping any that were deleted.
    public func labels(of task: TaskItem) -> [Label] { task.labelIds.compactMap(label) }

    /// The single path every change takes.
    public func commit(_ next: StoreData) {
        let before = snapshot.data
        var data = next
        data.tasks = StoreRules.sortTasks(next.tasks)
        snapshot.data = data
        SyncEngine.record(&snapshot, before: before, after: snapshot.data, now: clock.now.epochMilliseconds, nextOpId: newId)
        revision += 1
        scheduleWrite()
    }

    /// Drops local tasks for a different user without recording deletes, so they are not uploaded.
    public func switchUser() {
        SyncEngine.replaceForNewUser(&snapshot)
        revision += 1
        scheduleWrite()
    }

    /// Empties tasks, projects, and labels here, and asks the next sync to wipe them on the server.
    public func deleteAll() {
        SyncEngine.deleteAll(&snapshot)
        revision += 1
        scheduleWrite()
    }

    /// The body of `POST /api/sync`.
    public func syncRequest() throws -> API.SyncRequest? { try SyncEngine.request(snapshot) }

    /// Applies one sync response onto the document.
    public func takeSyncResponse(_ response: API.SyncResponse) -> Bool {
        let applied = SyncEngine.apply(&snapshot, response: response)
        if applied { scheduleWrite() }
        return applied
    }

    /// Keeps the outbox when the server stores this install under a different id.
    public func adoptDevice(_ deviceId: String) {
        guard var sync = snapshot.sync, sync.deviceId != deviceId else { return }
        sync.deviceId = deviceId
        snapshot.sync = sync
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

    // MARK: Commands

    @discardableResult
    public func addTask(_ input: NewTask, parentId: String? = nil) -> TaskItem {
        let (data, task) = StoreRules.addTask(snapshot.data, input, parentId: parentId, creation())
        commit(data)
        return task
    }

    public func updateTask(_ id: String, _ patch: TaskPatch) {
        commit(StoreRules.updateTask(snapshot.data, id, patch))
    }

    public func completeTask(_ id: String) -> Completion? {
        guard let result = StoreRules.completeTask(
            snapshot.data, id, today: clock.today, now: clock.now.epochMilliseconds
        ) else { return nil }
        commit(result.data)
        return result.completion
    }

    public func reopenTask(_ id: String) {
        commit(StoreRules.reopenTask(snapshot.data, id))
    }

    public func restoreCompletion(_ previous: [CompletionState]) {
        commit(StoreRules.restoreCompletion(snapshot.data, previous))
    }

    public func moveSubtask(_ id: String, to index: Int) {
        commit(StoreRules.moveSubtask(snapshot.data, id, index))
    }

    /// Deletes the task with every subtask under it, and returns them for undo.
    public func deleteTask(_ id: String) -> [TaskItem] {
        let (data, removed) = StoreRules.deleteTask(snapshot.data, id)
        commit(data)
        return removed
    }

    public func undeleteTasks(_ removed: [TaskItem]) {
        commit(StoreRules.undeleteTasks(snapshot.data, removed))
    }

    @discardableResult
    public func addProject(_ name: String) -> Project {
        let (data, project) = StoreRules.addProject(snapshot.data, name, creation())
        commit(data)
        return project
    }

    public func renameProject(_ id: String, _ name: String) {
        commit(StoreRules.renameProject(snapshot.data, id, name))
    }

    public func deleteProject(_ id: String) {
        commit(StoreRules.deleteProject(snapshot.data, id))
    }

    @discardableResult
    public func addLabel(_ name: String) -> Label {
        let (data, label) = StoreRules.addLabel(snapshot.data, name, creation())
        commit(data)
        return label
    }

    public func renameLabel(_ id: String, _ name: String) {
        commit(StoreRules.renameLabel(snapshot.data, id, name))
    }

    public func deleteLabel(_ id: String) {
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
