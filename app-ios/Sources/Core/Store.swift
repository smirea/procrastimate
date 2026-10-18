import Foundation
import Observation

/// The batch of row writes one command produced, for the space it ran on. `version` counts commits, so the database
/// writer can say which one it has finished.
public struct RowBatch: Hashable, Sendable {
    public let version: Int
    public let owner: String
    public let writes: [RowWrite]

    public init(version: Int, owner: String, writes: [RowWrite]) {
        self.version = version
        self.owner = owner
        self.writes = writes
    }
}

/// The app's one store: the local database's rows in memory, grouped into spaces, with every command from
/// `StoreRules`. A command applies to memory at once, and `commit` hands the rows it changed to `writer`, which writes
/// them to the local database in order. When the database changes, from a local write or from sync, the app reads it
/// again and calls `reload`.
@MainActor @Observable
public final class Store {
    /// The signed-in user: the owner of the own space and the `user_id` of every row written to it. Nil while a session
    /// token's owner is not known yet, when every commit waits in memory until `adopt` names them.
    public private(set) var me: String?
    /// The user's own data and settings.
    public private(set) var snapshot: Snapshot
    /// Every space shared with the user, by owner id.
    public private(set) var spaces: [String: Snapshot]
    public private(set) var access: [Access]
    /// Names for the ids in shares, comments, and activity. Kept on the device, never synced.
    public private(set) var people: [Person]

    /// Writes each commit's rows to the local database, one batch after another, then calls `written`.
    @ObservationIgnored public var writer: ((RowBatch) -> Void)?
    @ObservationIgnored private let clock: AppClock
    @ObservationIgnored private let newId: () -> String
    @ObservationIgnored private var version = 0
    @ObservationIgnored private var writtenVersion = 0
    @ObservationIgnored private var reloadDeferred = false
    /// Commits made while `me` was unknown, in order, for `adopt` to hand to the writer.
    @ObservationIgnored private var held: [(version: Int, space: SpaceKey, writes: [RowWrite])] = []
    @ObservationIgnored private var savedWaiters: [(version: Int, resume: CheckedContinuation<Void, Never>)] = []
    /// Whether the local database holds the user's settings row. Until it does, a settings change waits in
    /// `unsavedSettings`, so no client ever writes a settings row of its own.
    @ObservationIgnored private var settingsStored: Bool
    @ObservationIgnored private var unsavedSettings: [String: JSONValue] = [:]
    @ObservationIgnored private var readOnly: Set<String> = []
    /// Where each deleted task lived, so undo puts it back in the same space.
    @ObservationIgnored private var deletedFrom: [String: SpaceKey] = [:]
    /// Picks a color for a new label from its name after it is created, such as the on-device model on iOS. Nil keeps
    /// `LabelColors.defaultLabelColor`, which every label starts with so creating one stays instant and offline.
    @ObservationIgnored public var labelColorSuggester: ((String) async -> LabelColor?)?
    /// Labels created this session that no local command has renamed or recolored since, because comparing values
    /// misses a color changed and changed back before the suggestion arrives.
    @ObservationIgnored private var untouchedLabels: Set<String> = []

    public init(
        me: String?,
        spaces: Spaces = Spaces(),
        people: [Person] = [],
        clock: AppClock,
        newId: @escaping () -> String = { UUID().uuidString.lowercased() }
    ) {
        self.me = me
        self.clock = clock
        self.newId = newId
        self.people = people
        snapshot = spaces.own
        self.spaces = spaces.shared
        access = spaces.access
        readOnly = Self.readOnly(spaces.access)
        settingsStored = spaces.settingsStored
    }

    /// Replaces the data with what the local database holds. A reload read while a local commit was still on its way
    /// to the database would undo that commit on screen, so it waits until the writer catches up.
    public func reload(_ next: Spaces) {
        guard writtenVersion == version else {
            reloadDeferred = true
            return
        }
        settingsStored = next.settingsStored
        var own = next.own
        if !unsavedSettings.isEmpty, let settings = try? own.settings.merging(unsavedSettings) { own.settings = settings }
        if settingsStored, !unsavedSettings.isEmpty {
            unsavedSettings = [:]
            write(own, over: next.own, in: .own)
        } else if snapshot != own {
            snapshot = own
        }
        if spaces != next.shared { spaces = next.shared }
        if access != next.access {
            access = next.access
            readOnly = Self.readOnly(next.access)
        }
    }

    /// The writer finished every batch up to `version`. True when a reload was held back meanwhile, so the caller
    /// reads the database again.
    public func written(_ version: Int) -> Bool {
        writtenVersion = max(writtenVersion, version)
        let done = savedWaiters.filter { $0.version <= writtenVersion }
        savedWaiters.removeAll { $0.version <= writtenVersion }
        for waiter in done { waiter.resume.resume() }
        guard writtenVersion == self.version, reloadDeferred else { return false }
        reloadDeferred = false
        return true
    }

    /// Returns once the writer finished every commit made before the call, for work the process may not outlive, like
    /// an App Intent the system runs without the app on screen.
    public func saved() async {
        let target = version
        guard writtenVersion < target else { return }
        await withCheckedContinuation { savedWaiters.append((target, $0)) }
    }

    /// Names the owner of a store that started without one. The data stays, and every held commit goes to the writer
    /// as `id`'s, in order.
    public func adopt(_ id: String) {
        guard me == nil else { return }
        me = id
        let held = self.held
        self.held = []
        for batch in held { send(batch.version, batch.space, batch.writes) }
    }

    /// Starts over empty for another user, after the app cleared the local database.
    public func switchUser(to me: String) {
        self.me = me
        snapshot = .empty
        spaces = [:]
        access = []
        people = []
        readOnly = []
        deletedFrom = [:]
        held = []
        settingsStored = false
        unsavedSettings = [:]
    }

    private static func readOnly(_ access: [Access]) -> Set<String> {
        Set(access.filter { $0.kind == .task && $0.role == .view }.map(\.entityId))
    }

    /// The user's own tasks, projects (in their order), and labels, which the personal views (Inbox, Today, No date,
    /// places, search) show.
    public var tasks: [TaskItem] { snapshot.tasks }
    public var projects: [Project] { StoreRules.projectsInOrder(snapshot.projects) }
    public var labels: [Label] { snapshot.labels }
    public var sections: [ProjectSection] { snapshot.sections }

    private var sharedData: [Snapshot] { spaces.keys.sorted().compactMap { spaces[$0] } }

    public var allTasks: [TaskItem] { snapshot.tasks + sharedData.flatMap(\.tasks) }
    public var allProjects: [Project] { snapshot.projects + sharedData.flatMap(\.projects) }
    public var allLabels: [Label] { snapshot.labels + sharedData.flatMap(\.labels) }
    public var allSections: [ProjectSection] { snapshot.sections + sharedData.flatMap(\.sections) }

    /// Shared spaces by owner name, with their ids. An owner the people cache does not know yet shows as `Someone`.
    public var sharedSpaces: [SharedSpace] {
        spaces.map { id, data in
            SharedSpace(id: id, owner: person(id) ?? Person(id: id, name: "Someone", kind: .human), data: data)
        }
        .sorted { ($0.owner.name, $0.id) < ($1.owner.name, $1.id) }
    }

    public func task(_ id: String) -> TaskItem? {
        snapshot.tasks.first { $0.id == id }
            ?? spaces.values.lazy.compactMap { $0.tasks.first { $0.id == id } }.first
    }

    public func project(_ id: String?) -> Project? {
        guard let id else { return nil }
        return snapshot.projects.first { $0.id == id }
            ?? spaces.values.lazy.compactMap { $0.projects.first { $0.id == id } }.first
    }

    public func section(_ id: String?) -> ProjectSection? {
        guard let id else { return nil }
        return snapshot.sections.first { $0.id == id }
            ?? spaces.values.lazy.compactMap { $0.sections.first { $0.id == id } }.first
    }

    public func sections(of projectId: String) -> [ProjectSection] { StoreRules.sectionsOf(allSections, projectId) }

    public func label(_ id: String) -> Label? {
        snapshot.labels.first { $0.id == id }
            ?? spaces.values.lazy.compactMap { $0.labels.first { $0.id == id } }.first
    }

    public func labels(of task: TaskItem) -> [Label] { task.labelIds.compactMap(label) }

    public func space(ofTask id: String) -> SpaceKey? { space { $0.tasks.contains { $0.id == id } } }
    public func space(ofProject id: String) -> SpaceKey? { space { $0.projects.contains { $0.id == id } } }
    public func space(ofLabel id: String) -> SpaceKey? { space { $0.labels.contains { $0.id == id } } }

    private func space(where holds: (Snapshot) -> Bool) -> SpaceKey? {
        if holds(snapshot) { return .own }
        return spaces.first { holds($0.value) }.map { .shared($0.key) }
    }

    public func data(in space: SpaceKey) -> StoreData {
        switch space {
        case .own: snapshot.data
        case let .shared(id): spaces[id]?.data ?? StoreData()
        }
    }

    /// The projects and labels a task in this space can pick. A task never leaves its space.
    public func projects(in space: SpaceKey) -> [Project] { StoreRules.projectsInOrder(data(in: space).projects) }
    public func labels(in space: SpaceKey) -> [Label] { data(in: space).labels }

    /// The owner of a shared space, or nil for the user's own.
    public func owner(of space: SpaceKey) -> Person? {
        space.query.map { person($0) ?? Person(id: $0, name: "Someone", kind: .human) }
    }

    public func isReadOnly(_ taskID: String) -> Bool { readOnly.contains(taskID) }

    public func person(_ id: String?) -> Person? {
        guard let id else { return nil }
        return people.first { $0.id == id }
    }

    public func rememberPeople(_ known: [Person]) {
        var next = people
        for person in known {
            if let index = next.firstIndex(where: { $0.id == person.id }) {
                next[index] = person
            } else {
                next.append(person)
            }
        }
        if next != people { people = next }
    }

    public func commit(_ next: StoreData) { commit(next, in: .own) }

    /// Commits into the space the command ran on, so its rows keep that space's owner.
    public func commit(_ next: StoreData, in space: SpaceKey) {
        let before: Snapshot
        switch space {
        case .own: before = snapshot
        case let .shared(id):
            guard let shared = spaces[id] else { return }
            before = shared
        }
        var after = before
        after.data = next
        after.tasks = StoreRules.sortTasks(next.tasks)
        write(after, over: before, in: space)
    }

    private func write(_ after: Snapshot, over before: Snapshot, in space: SpaceKey) {
        switch space {
        case .own: snapshot = after
        case let .shared(id): spaces[id] = after
        }
        let writes = Rows.rowWrites(before, after)
        guard writer != nil, !writes.isEmpty else { return }
        version += 1
        send(version, space, writes)
    }

    private func send(_ version: Int, _ space: SpaceKey, _ writes: [RowWrite]) {
        guard let me else {
            held.append((version, space, writes))
            return
        }
        writer?(RowBatch(version: version, owner: space.query ?? me, writes: writes))
    }

    /// Deletes every row of the user's own space. Settings stay, since every user has them.
    public func deleteAll() {
        commit(StoreData())
    }

    /// A change before the settings row arrived shows at once and patches the row once a reload brings it.
    private func setSettings(_ change: (inout API.Settings) -> Void) {
        var after = snapshot
        change(&after.settings)
        guard after != snapshot else { return }
        guard settingsStored else {
            for write in Rows.rowWrites(snapshot, after) { unsavedSettings.merge(write.values ?? [:]) { _, new in new } }
            snapshot = after
            return
        }
        write(after, over: snapshot, in: .own)
    }

    public var dictation: DictationChoice { snapshot.settings.dictation }

    public func setDictation(_ choice: DictationChoice) { setSettings { $0.dictation = choice } }

    public var quickAddButtons: [QuickAddButton] { snapshot.settings.quickAddButtons }

    public func setQuickAddButtons(_ buttons: [QuickAddButton]) { setSettings { $0.quickAddButtons = buttons } }

    /// Writes this device's zone into the settings when it differs, so the server plans notifications in it.
    public func noteTimeZone(_ timeZone: String) { setSettings { $0.timeZone = timeZone } }

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

    /// Returns what the delete removed, for `undelete`.
    @discardableResult
    public func deleteProject(_ id: String) -> Deleted? {
        guard space(ofProject: id) == .own else { return nil }
        return delete(StoreRules.deleteProject(snapshot.data, id))
    }

    public func moveProject(_ id: String, to index: Int) {
        guard space(ofProject: id) == .own else { return }
        commit(StoreRules.moveProject(snapshot.data, id, index))
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

    @discardableResult
    public func deleteSection(_ id: String) -> Deleted? {
        guard snapshot.sections.contains(where: { $0.id == id }) else { return nil }
        return delete(StoreRules.deleteSection(snapshot.data, id))
    }

    @discardableResult
    public func addLabel(_ name: String) -> Label {
        let (data, label) = StoreRules.addLabel(snapshot.data, name, creation())
        commit(data)
        untouchedLabels.insert(label.id)
        if labelColorSuggester != nil { Task { await suggestColor(for: label) } }
        return label
    }

    /// Applies `labelColorSuggester`'s color to a label created as `label`, per `StoreRules.suggestLabelColor`.
    public func suggestColor(for label: Label) async {
        guard let suggester = labelColorSuggester, let color = await suggester(label.name),
              untouchedLabels.remove(label.id) != nil,
              let next = StoreRules.suggestLabelColor(snapshot.data, label, color)
        else { return }
        commit(next)
    }

    public func renameLabel(_ id: String, _ name: String) {
        guard space(ofLabel: id) == .own else { return }
        untouchedLabels.remove(id)
        commit(StoreRules.renameLabel(snapshot.data, id, name))
    }

    /// Nil when a label already has the name.
    @discardableResult
    public func savePlace(_ name: String, _ place: SavedPlace) -> Label? {
        let (data, label) = StoreRules.savePlace(snapshot.data, name, place, creation())
        if label != nil { commit(data) }
        return label
    }

    public func setPlaceRadius(_ id: String, _ radius: Double) {
        guard space(ofLabel: id) == .own else { return }
        commit(StoreRules.setPlaceRadius(snapshot.data, id, radius))
    }

    public func setLabelColor(_ id: String, _ color: LabelColor) {
        guard space(ofLabel: id) == .own else { return }
        untouchedLabels.remove(id)
        commit(StoreRules.setLabelColor(snapshot.data, id, color))
    }

    @discardableResult
    public func deleteLabel(_ id: String) -> Deleted? {
        guard space(ofLabel: id) == .own else { return nil }
        return delete(StoreRules.deleteLabel(snapshot.data, id))
    }

    private func delete(_ after: StoreData) -> Deleted {
        let deleted = StoreRules.deletedBetween(snapshot.data, after)
        commit(after)
        return deleted
    }

    public func undelete(_ deleted: Deleted) {
        commit(StoreRules.undelete(snapshot.data, deleted))
    }

    /// Adds a Todoist backup in one command and one write, skipping tasks an earlier import already added.
    public func importTodoist(_ backup: Todoist.Backup) -> Todoist.Summary {
        let (data, summary) = Todoist.mergeBackup(snapshot.data, backup, newId: newId, now: clock.now.epochMilliseconds)
        commit(data)
        return summary
    }

    public var allComments: [Comment] { snapshot.comments + sharedData.flatMap(\.comments) }

    /// One task's comments, oldest first.
    public func comments(on taskID: String) -> [Comment] { Comments.commentsOn(allComments, taskID) }

    /// A task's comment count and how many of them someone else wrote since `me` last read it, or nil without any.
    public func commentBadge(_ taskID: String, me: String?) -> CommentBadge? {
        Comments.commentBadges(allComments.filter { $0.taskId == taskID }, snapshot.reads, me)[taskID]
    }

    /// Comments are written in the task's space, so only someone who may edit the task can comment on it.
    @discardableResult
    public func addComment(_ taskID: String, _ body: String, by me: String) -> Comment? {
        guard let space = space(ofTask: taskID), !isReadOnly(taskID) else { return nil }
        let (next, comment) = Comments.addComment(data(in: space), taskID, body, me, creation())
        guard comment != nil else { return nil }
        commit(next, in: space)
        return comment
    }

    public func editComment(_ id: String, _ body: String, by me: String) {
        guard let comment = allComments.first(where: { $0.id == id }) else { return }
        let now = clock.now.epochMilliseconds
        edit(comment.taskId) { Comments.editComment($0, id, body, me, now) }
    }

    /// Deletes `me`'s own comment and returns it for undo.
    @discardableResult
    public func deleteComment(_ id: String, by me: String) -> Comment? {
        guard let comment = allComments.first(where: { $0.id == id && $0.authorId == me }) else { return nil }
        edit(comment.taskId) { Comments.deleteComment($0, id, me) }
        return comment
    }

    public func undeleteComment(_ comment: Comment) {
        edit(comment.taskId) { data in
            guard !data.comments.contains(where: { $0.id == comment.id }) else { return data }
            var next = data
            next.comments.append(comment)
            return next
        }
    }

    /// The marker goes into the user's own space, whichever space holds the task.
    public func markCommentsRead(_ taskID: String, by me: String) {
        let next = Comments.markRead(snapshot.data, taskID, allComments, me, clock.now.epochMilliseconds)
        guard next != snapshot.data else { return }
        commit(next)
    }
}
