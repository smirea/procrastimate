import Core
import SwiftUI

struct TodayScreen: View {
    @Environment(Store.self) private var store
    @Environment(\.clock) private var clock
    @Environment(\.today) private var today

    var body: some View {
        let tasks = Views.todayTasks(store.tasks, today)
        TaskListScreen(
            title: "Today",
            isEmpty: tasks.overdue.isEmpty && tasks.today.isEmpty,
            emptyTitle: "All clear for today",
            emptyHint: "Enjoy it, or tap + to add something.",
            quickAdd: QuickAddDefaults(today: true)
        ) {
            if tasks.overdue.isEmpty {
                ForEach(tasks.today) { TaskRow(task: $0, showProject: true, timeOnly: true) }
            } else {
                Section {
                    ForEach(tasks.overdue) { TaskRow(task: $0, showProject: true) }
                } header: {
                    ListHeading(text: "Overdue", tone: .toneOverdue)
                }
                Section {
                    ForEach(tasks.today) { TaskRow(task: $0, showProject: true, timeOnly: true) }
                } header: {
                    ListHeading(text: "Today")
                }
            }
        }
        .navigationSubtitle(
            clock.now.formatted(Date.FormatStyle(timeZone: clock.timeZone).weekday(.wide).month(.wide).day())
        )
    }
}
