import Core
import SwiftUI

/// Every open task at one place, each naming its project, like a label screen.
struct PlaceScreen: View {
    @Environment(Store.self) private var store
    let key: String

    var body: some View {
        let tasks = Views.placeTasks(store.tasks, key, in: store.timeZone)
        let title = tasks.first?.location?.name ?? "Place"
        TaskListScreen(
            title: title,
            isEmpty: tasks.isEmpty,
            emptyTitle: "No tasks at this place",
            emptyHint: "Set a place from a task's details.",
            open: tasks.count
        ) {
            ForEach(tasks) { TaskRow(task: $0, showProject: true) }
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                CopyMarkdownButton(document: Markdown.Document(title: title, sections: [.init(tasks: tasks)]))
            }
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
            open: tasks.count
        ) {
            ForEach(tasks) { TaskRow(task: $0, showProject: true) }
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                CopyMarkdownButton(document: Markdown.Document(title: title, sections: [.init(tasks: tasks)]))
            }
        }
    }
}
