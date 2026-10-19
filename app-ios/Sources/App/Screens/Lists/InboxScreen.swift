import Core
import SwiftUI

/// Everything due, by day, overdue first. Undated tasks live in their own tab.
struct InboxScreen: View {
    @Environment(Store.self) private var store
    @Environment(\.today) private var today

    var body: some View {
        let due = Views.todayTasks(store.tasks, today, in: store.timeZone)
        let days = Views.upcomingGroups(store.tasks, today, in: store.timeZone)
        let sections = [Markdown.Section(heading: "Overdue", tasks: due.overdue), .init(heading: "Today", tasks: due.today)]
            + days.map { Markdown.Section(heading: Format.dayHeading($0.date, today), tasks: $0.tasks) }
        TaskListScreen(
            title: "Inbox",
            isEmpty: due.overdue.isEmpty && due.today.isEmpty && days.isEmpty,
            emptyTitle: "Nothing scheduled",
            emptyHint: "Tasks with a date show up here by day.",
            root: true,
            open: due.overdue.count + due.today.count + days.reduce(0) { $0 + $1.tasks.count },
            markdown: Markdown.Document(title: "Inbox", sections: sections.filter { !$0.tasks.isEmpty })
        ) {
            if !due.overdue.isEmpty {
                Section {
                    ForEach(due.overdue) { TaskRow(task: $0, showProject: $0.projectId != nil) }
                } header: {
                    ListHeading(text: "Overdue", tone: .toneOverdue, tasks: due.overdue)
                }
            }
            if !due.today.isEmpty {
                Section {
                    ForEach(due.today) { TaskRow(task: $0, showProject: $0.projectId != nil, timeOnly: true) }
                    GroupAddRow(group: "Today", addTo: .inbox(date: today))
                } header: {
                    ListHeading(text: "Today", tasks: due.today, addTo: .inbox(date: today))
                }
            }
            ForEach(days, id: \.date) { group in
                Section {
                    ForEach(group.tasks) { TaskRow(task: $0, showProject: $0.projectId != nil) }
                    GroupAddRow(group: Format.dayHeading(group.date, today), addTo: .inbox(date: group.date))
                } header: {
                    ListHeading(text: Format.dayHeading(group.date, today), tasks: group.tasks, addTo: .inbox(date: group.date))
                }
            }
        }
    }
}

/// Inbox tasks without a date, which would otherwise always sit at the bottom of Inbox, by when they were added. Places
/// with two or more of them group below the rest.
struct NoDateScreen: View {
    @Environment(Store.self) private var store
    @Environment(\.today) private var today
    @AppStorage("noDateNewestFirst") private var newestFirst = true

    var body: some View {
        let view = Views.noDateTasks(store.tasks, today, newestFirst: newestFirst, in: store.timeZone)
        TaskListScreen(
            title: "No date",
            isEmpty: view.loose.isEmpty && view.places.isEmpty,
            emptyTitle: "Inbox zero",
            emptyHint: "Tap + to capture a task.",
            root: true,
            newestFirst: $newestFirst,
            open: view.loose.count + view.places.reduce(0) { $0 + $1.tasks.count },
            markdown: Markdown.Document(
                title: "No date",
                sections: [.init(tasks: view.loose)] + view.places.map { .init(heading: $0.name, tasks: $0.tasks) }
            )
        ) {
            ForEach(view.loose) { row($0) }
            ForEach(view.places, id: \.key) { place in
                Section {
                    ForEach(place.tasks) { row($0) }
                    GroupAddRow(group: place.name, addTo: .place(key: place.key))
                } header: {
                    ListHeading(text: place.name, tasks: place.tasks, addTo: .place(key: place.key))
                }
            }
        }
        .animation(.snappy, value: newestFirst)
    }

    private func row(_ task: TaskItem) -> some View {
        TaskRow(task: task, added: Format.addedAgo(Dates.toDateKey(Date(timeIntervalSince1970: Double(task.createdAt) / 1000), in: store.timeZone), today))
    }
}
