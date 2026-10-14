import Core
import SwiftUI

/// Everything due, by day, overdue first. Undated tasks live in their own tab.
struct InboxScreen: View {
    @Environment(Store.self) private var store
    @Environment(\.today) private var today

    var body: some View {
        let due = Views.todayTasks(store.tasks, today, in: store.timeZone)
        let days = Views.upcomingGroups(store.tasks, today, in: store.timeZone)
        TaskListScreen(
            title: "Inbox",
            isEmpty: due.overdue.isEmpty && due.today.isEmpty && days.isEmpty,
            emptyTitle: "Nothing scheduled",
            emptyHint: "Tasks with a date show up here by day.",
            root: true
        ) {
            if !due.overdue.isEmpty {
                Section {
                    ForEach(due.overdue) { TaskRow(task: $0, showProject: $0.projectId != nil) }
                } header: {
                    ListHeading(text: "Overdue", tone: .toneOverdue)
                }
            }
            if !due.today.isEmpty {
                Section {
                    ForEach(due.today) { TaskRow(task: $0, showProject: $0.projectId != nil, timeOnly: true) }
                } header: {
                    ListHeading(text: "Today")
                }
            }
            ForEach(days, id: \.date) { group in
                Section {
                    ForEach(group.tasks) { TaskRow(task: $0, showProject: $0.projectId != nil, timeOnly: true) }
                } header: {
                    ListHeading(text: Format.dayHeading(group.date, today))
                }
            }
        }
    }
}

/// Inbox tasks without a date, which would otherwise always sit at the bottom of Inbox. Places with two or more of them
/// group below the rest.
struct NoDateScreen: View {
    @Environment(Store.self) private var store
    @Environment(\.today) private var today

    var body: some View {
        let view = Views.noDateTasks(store.tasks, today, in: store.timeZone)
        TaskListScreen(
            title: "No date",
            isEmpty: view.loose.isEmpty && view.places.isEmpty,
            emptyTitle: "Inbox zero",
            emptyHint: "Tap + to capture a task.",
            root: true
        ) {
            ForEach(view.loose) { TaskRow(task: $0) }
            ForEach(view.places, id: \.key) { place in
                Section {
                    ForEach(place.tasks) { TaskRow(task: $0) }
                } header: {
                    ListHeading(text: place.name)
                }
            }
        }
    }
}
