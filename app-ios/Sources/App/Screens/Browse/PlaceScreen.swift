import Core
import SwiftUI

/// Every open task at one place, each naming its project, like a label screen. A saved place is its label's screen,
/// so a pin or link from before it was saved shows that.
struct PlaceScreen: View {
    @Environment(Store.self) private var store
    let key: String

    @State private var saving = false

    var body: some View {
        if let saved = Triggers.savedPlaceAt(store.labels, key) {
            LabelScreen(labelID: saved.id)
        } else {
            unsaved
        }
    }

    private var unsaved: some View {
        let tasks = Views.placeTasks(store.tasks, key, in: store.timeZone)
        let title = tasks.first?.location?.name ?? "Place"
        // The earliest task names the place, so its spot and radius are what gets saved.
        let location = tasks.min { $0.createdAt < $1.createdAt }?.location
        return TaskListScreen(
            title: title,
            isEmpty: tasks.isEmpty,
            emptyTitle: "No tasks at this place",
            emptyHint: "Set a place from a task's details.",
            open: tasks.count,
            markdown: Markdown.Document(title: title, sections: [.init(tasks: tasks)])
        ) {
            ForEach(tasks) { TaskRow(task: $0, showProject: true) }
        }
        .toolbar {
            if location != nil {
                ToolbarItem(placement: .primaryAction) {
                    Button("Save place", systemImage: "bookmark") { saving = true }
                        .accessibilityIdentifier("save-place")
                }
            }
        }
        .sheet(isPresented: $saving) {
            if let location { PlaceSheet(mode: .save(location)) }
        }
    }
}

/// Every open task on one calendar event, in the order their moments come.
struct EventScreen: View {
    @Environment(Store.self) private var store
    @Environment(\.today) private var today
    let eventID: String

    var body: some View {
        let tasks = Views.eventTasks(store.tasks, eventID, today, in: store.timeZone)
        let title = tasks.first?.event?.title ?? "Event"
        TaskListScreen(
            title: title,
            isEmpty: tasks.isEmpty,
            emptyTitle: "No tasks on this event",
            emptyHint: "Link an event from a task's details.",
            open: tasks.count,
            markdown: Markdown.Document(title: title, sections: [.init(tasks: tasks)])
        ) {
            ForEach(tasks) { TaskRow(task: $0, showProject: true) }
        }
    }
}
