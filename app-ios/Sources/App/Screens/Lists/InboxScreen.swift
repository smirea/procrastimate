import Core
import SwiftUI

/// Everything due by day, overdue first, then the Inbox's undated tasks.
struct InboxScreen: View {
    @Environment(Store.self) private var store
    @Environment(\.today) private var today

    var body: some View {
        let due = Views.todayTasks(store.tasks, today, in: store.timeZone)
        let days = Views.upcomingGroups(store.tasks, today, in: store.timeZone)
        let undated = Views.inboxTasks(store.tasks, today, in: store.timeZone)
        TaskListScreen(
            title: "Inbox",
            isEmpty: due.overdue.isEmpty && due.today.isEmpty && days.isEmpty && undated.isEmpty,
            emptyTitle: "Inbox zero",
            emptyHint: "Tap + to capture a task.",
            root: true
        ) {
            if !due.overdue.isEmpty {
                Section {
                    ForEach(due.overdue) { TaskRow(task: $0, showProject: true) }
                } header: {
                    ListHeading(text: "Overdue", tone: .toneOverdue)
                }
            }
            if !due.today.isEmpty {
                Section {
                    ForEach(due.today) { TaskRow(task: $0, showProject: true, timeOnly: true) }
                } header: {
                    ListHeading(text: "Today")
                }
            }
            ForEach(days, id: \.date) { group in
                Section {
                    ForEach(group.tasks) { TaskRow(task: $0, showProject: true, timeOnly: true) }
                } header: {
                    ListHeading(text: Format.dayHeading(group.date, today))
                }
            }
            if !undated.isEmpty {
                Section {
                    ForEach(undated) { TaskRow(task: $0) }
                } header: {
                    ListHeading(text: "No date")
                }
            }
        }
    }
}
