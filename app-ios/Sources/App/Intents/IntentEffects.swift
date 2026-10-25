import Core
import SwiftUI

@MainActor
enum IntentEffects {
    static func snapshot() -> (Snapshot, AppClock) {
        let session = IntentSession.current!
        return (session.store.snapshot, session.clock)
    }

    static func tasks(ids: [String]) -> [TaskEntity] {
        let (snapshot, clock) = snapshot()
        return ids.compactMap { id in
            snapshot.tasks.first { $0.id == id }.map { entity($0, snapshot, clock) }
        }
    }

    static func tasks(matching query: String) -> [TaskEntity] {
        let (snapshot, clock) = snapshot()
        return IntentRules.candidates(
            snapshot.tasks, query: query, projects: snapshot.projects, labels: snapshot.labels
        ).map { entity($0, snapshot, clock) }
    }

    static func suggestedTasks() -> [TaskEntity] {
        let (snapshot, clock) = snapshot()
        return IntentRules.suggestedTasks(snapshot.tasks).map { entity($0, snapshot, clock) }
    }

    static func projects(ids: [String]) -> [ProjectEntity] {
        let (snapshot, _) = snapshot()
        return ids.compactMap { id in
            snapshot.projects.first { $0.id == id }.map { ProjectEntity($0) }
        }
    }

    static func projects(matching query: String) -> [ProjectEntity] {
        let (snapshot, _) = snapshot()
        return IntentRules.rankedNames(orderedProjects(snapshot), query, name: \.name).map { ProjectEntity($0) }
    }

    static func suggestedProjects() -> [ProjectEntity] {
        let (snapshot, _) = snapshot()
        return orderedProjects(snapshot).map { ProjectEntity($0) }
    }

    static func labels(ids: [String]) -> [LabelEntity] {
        let (snapshot, _) = snapshot()
        return ids.compactMap { id in
            snapshot.labels.first { $0.id == id }.map(LabelEntity.init)
        }
    }

    static func labels(matching query: String) -> [LabelEntity] {
        let (snapshot, _) = snapshot()
        return IntentRules.rankedNames(Browse.labelsByName(snapshot.labels), query, name: \.name)
            .map(LabelEntity.init)
    }

    static func suggestedLabels() -> [LabelEntity] {
        let (snapshot, _) = snapshot()
        return Browse.labelsByName(snapshot.labels).map(LabelEntity.init)
    }

    static func add(
        text: String,
        project: ProjectEntity?,
        labels: [LabelEntity],
        priority: Priority?,
        due: Date?,
        reminder: Date?
    ) async -> String {
        await withStore { store, clock, _ in
            let request = IntentRules.AddRequest(
                text: text,
                projectId: project.flatMap { entity in store.project(entity.id)?.id },
                labelIds: labels.compactMap { store.label($0.id)?.id },
                priority: priority,
                due: due.map { IntentRules.due(from: $0, in: clock.timeZone) },
                reminders: reminder.map { [IntentRules.reminder(at: $0, in: clock.timeZone)] } ?? []
            )
            guard let task = IntentRules.newTask(
                request,
                projects: store.projects,
                sections: store.sections,
                labels: store.labels,
                now: clock.now,
                zone: clock.timeZone
            ) else {
                note("empty")
                return "That didn't leave a task name."
            }
            withAnimation(.snappy) { _ = store.addTask(task) }
            note("added \(task.title)")
            if let due = task.due {
                return "Added “\(task.title)”, due \(Format.formatDue(due, clock.today))"
            }
            return "Added “\(task.title)”"
        }
    }

    static func complete(_ entity: TaskEntity) async -> String {
        await withStore { store, clock, session in
            guard let target = IntentRules.completionTarget(
                .complete, id: entity.id, title: entity.title, in: store.tasks
            ) else {
                note("already-complete \(entity.title)")
                return "No open task named “\(entity.title)”"
            }
            let message: String
            if let spoken = session.actions.complete(target) {
                message = spoken
            } else if let completion = store.completeTask(target.id) {
                message = Format.completedToast(target.title, completion.next, clock.today)
            } else {
                note("already-complete \(target.title)")
                return "No open task named “\(target.title)”"
            }
            note("completed \(target.title)")
            return message
        }
    }

    /// A widget's checkbox names the task it drew, so there is no title to resolve. A task already done or gone, such
    /// as one completed on another device since, is left alone.
    static func complete(id: String) async {
        await withStore { store, _, _ in
            guard let task = store.task(id), task.completedAt == nil else { return }
            _ = store.completeTask(task.id)
            note("widget-completed \(task.title)")
        }
    }

    static func open(_ url: URL) {
        let session = IntentSession.current!
        guard let link = AppLink(url) else { return }
        session.navigator.open(link, in: session.store, today: session.clock.today)
        note("opened-link \(url.absoluteString)")
    }

    static func reopen(_ entity: TaskEntity) async -> String {
        await withStore { store, _, session in
            guard let target = IntentRules.completionTarget(
                .reopen, id: entity.id, title: entity.title, in: store.tasks
            ) else {
                note("still-open \(entity.title)")
                return "No completed task named “\(entity.title)”"
            }
            withAnimation(.snappy) { store.reopenTask(target.id) }
            let message = "Reopened “\(target.title)”"
            session.toasts.show(message)
            note("reopened \(target.title)")
            return message
        }
    }

    static func startRamble() -> String {
        let session = IntentSession.current!
        session.navigator.sheet = .ramble(QuickAddDefaults())
        note("ramble")
        return "Listening"
    }

    static func open(_ route: Route?, name: String) -> String {
        let session = IntentSession.current!
        session.navigator.sheet = nil
        if let route {
            session.navigator.open(route)
        } else {
            session.navigator.paths[.browse] = []
            session.navigator.tab = .browse
        }
        note("opened \(name.lowercased())")
        return "Showing \(name)"
    }

    static func open(project: ProjectEntity) -> String {
        let session = IntentSession.current!
        guard session.store.project(project.id) != nil else {
            note("gone \(project.name)")
            return "That project is no longer here."
        }
        session.navigator.sheet = nil
        session.navigator.open(.project(id: project.id))
        note("opened-project \(project.name)")
        return "Showing \(project.name)"
    }

    static func open(task: TaskEntity) -> String {
        let session = IntentSession.current!
        guard let stored = session.store.task(task.id) else {
            note("gone \(task.title)")
            return "That task is no longer here."
        }
        session.navigator.sheet = .details(taskID: stored.id)
        note("opened-task \(stored.title)")
        return "Showing \(stored.title)"
    }

    static func search(query: String) -> (dialog: String, entities: [TaskEntity]) {
        let (snapshot, clock) = snapshot()
        let tasks = IntentRules.searchTasks(query, snapshot.tasks, projects: snapshot.projects, labels: snapshot.labels)
        IntentSession.current.navigator.showSearch(query: query)
        let titles = tasks.map(\.title).joined(separator: ", ")
        note("search \(query): \(titles)")
        let dialog = tasks.isEmpty
            ? "No results for “\(query)”"
            : "\(tasks.count) \(tasks.count == 1 ? "result" : "results"): \(titles)"
        return (dialog, tasks.map { entity($0, snapshot, clock) })
    }

    static func listToday() -> (dialog: String, entities: [TaskEntity]) {
        list(overdue: false)
    }

    static func listOverdue() -> (dialog: String, entities: [TaskEntity]) {
        list(overdue: true)
    }

    static func note(_ line: String) {
        IntentSession.current.router.note(line)
    }

    private static func list(overdue: Bool) -> (dialog: String, entities: [TaskEntity]) {
        let (snapshot, clock) = snapshot()
        let today = Views.todayTasks(snapshot.tasks, clock.today, in: clock.timeZone)
        let tasks = overdue ? today.overdue : today.today
        let titles = tasks.map(\.title).joined(separator: ", ")
        note("\(overdue ? "overdue" : "today") \(titles)")
        let dialog: String
        if tasks.isEmpty {
            dialog = overdue ? "Nothing overdue" : "Nothing due today"
        } else {
            dialog = "\(overdue ? "Overdue" : "Today"): \(titles)"
        }
        return (dialog, tasks.map { entity($0, snapshot, clock) })
    }

    private static func entity(_ task: TaskItem, _ snapshot: Snapshot, _ clock: AppClock) -> TaskEntity {
        TaskEntity.make(task, projects: snapshot.projects, labels: snapshot.labels, today: clock.today)
    }

    private static func orderedProjects(_ snapshot: Snapshot) -> [Project] {
        StoreRules.projectsInOrder(snapshot.projects)
    }

    static func spotlightEntities() -> [TaskEntity] {
        let (snapshot, clock) = snapshot()
        return IntentRules.indexedTasks(snapshot.tasks).map { entity($0, snapshot, clock) }
    }

    static func spotlightEntities(ids: [String]) -> (keep: [TaskEntity], drop: [String]) {
        let (snapshot, clock) = snapshot()
        let open = Dictionary(uniqueKeysWithValues: IntentRules.indexedTasks(snapshot.tasks).map { ($0.id, $0) })
        var keep: [TaskEntity] = []
        var drop: [String] = []
        for id in ids {
            if let task = open[id] {
                keep.append(entity(task, snapshot, clock))
            } else {
                drop.append(id)
            }
        }
        return (keep, drop)
    }

    /// Returns once the local database holds the command, since the system may suspend the process as soon as the
    /// intent returns, even with the app open.
    /// Runs the change, then writes the notification schedule before answering: the open app's view does that on the
    /// next frame, which is too late when the intent ran first, and never when the app is not showing.
    private static func withStore<T>(_ body: (Store, AppClock, IntentSession) -> T) async -> T {
        let session = IntentSession.current!
        let result = body(session.store, session.clock, session)
        SpotlightIndex.schedule(session)
        WidgetSync.write(session.store, clock: session.clock)
        await session.notifications.resync()
        await SyncClient.shared(clock: session.clock).saved()
        return result
    }
}
