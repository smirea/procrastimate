import Core
import SwiftUI

/// Every open task at one place, each naming its project, like a label screen. A saved place is its label's screen,
/// so a pin or link from before it was saved shows that.
struct PlaceScreen: View {
    @Environment(Store.self) private var store
    @Environment(TaskActions.self) private var actions
    let key: String

    @State private var saving = false
    @StoredFilter private var filter: ListFilter

    init(key: String) {
        self.key = key
        _filter = StoredFilter(.place(key: key))
    }

    var body: some View {
        if let saved = Triggers.savedPlaceAt(store.labels, key) {
            LabelScreen(labelID: saved.id)
        } else {
            unsaved
        }
    }

    private var unsaved: some View {
        let all = Views.placeTasks(store.openTasks, key, in: store.timeZone)
        let tasks = ListFilters.filterTasks(all, filter, me: store.me)
        let title = all.first?.location?.name ?? "Place"
        // The earliest task names the place, so its spot and radius are what gets saved.
        let location = all.min { $0.createdAt < $1.createdAt }?.location
        return TaskListScreen(
            title: title,
            isEmpty: all.isEmpty,
            emptyTitle: "No tasks at this place",
            emptyHint: "Set a place from a task's details.",
            open: tasks.count,
            header: ListHeaders.listHeader(.place(saveable: location != nil)),
            actions: ListActions(
                noun: "place",
                name: title,
                copy: { actions.copyAsMarkdown(Markdown.Document(title: title, sections: [.init(tasks: tasks)])) },
                savePlace: { saving = true }
            ),
            filter: $filter,
            unfiltered: all
        ) {
            ForEach(tasks) { TaskRow(task: $0, showProject: true) }
        }
        .animation(.snappy, value: filter)
        .sheet(isPresented: $saving) {
            if let location { PlaceSheet(mode: .save(location)) }
        }
    }
}

/// Every open task on one calendar event, in the order their moments come.
struct EventScreen: View {
    @Environment(Store.self) private var store
    @Environment(TaskActions.self) private var actions
    @Environment(\.today) private var today
    let eventID: String
    @StoredFilter private var filter: ListFilter

    init(eventID: String) {
        self.eventID = eventID
        _filter = StoredFilter(.event(id: eventID))
    }

    var body: some View {
        let all = Views.eventTasks(store.openTasks, eventID, today, in: store.timeZone)
        let tasks = ListFilters.filterTasks(all, filter, me: store.me)
        let title = all.first?.event?.title ?? "Event"
        TaskListScreen(
            title: title,
            isEmpty: all.isEmpty,
            emptyTitle: "No tasks on this event",
            emptyHint: "Link an event from a task's details.",
            open: tasks.count,
            header: ListHeaders.listHeader(.event),
            actions: ListActions(
                noun: "event",
                name: title,
                copy: { actions.copyAsMarkdown(Markdown.Document(title: title, sections: [.init(tasks: tasks)])) }
            ),
            filter: $filter,
            unfiltered: all
        ) {
            ForEach(tasks) { TaskRow(task: $0, showProject: true) }
        }
        .animation(.snappy, value: filter)
    }
}
