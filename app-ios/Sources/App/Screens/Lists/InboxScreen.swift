import Core
import SwiftUI

/// A dated list by day, overdue first: Inbox lists everything due, This week through Sunday, and Tomorrow only
/// tomorrow, without a heading its title already names. Undated tasks live in their own tab.
struct DueScreen: View {
    @Environment(Store.self) private var store
    @Environment(TaskActions.self) private var actions
    @Environment(\.today) private var today
    let list: Views.DueList
    @StoredFilter private var filter: ListFilter

    init(list: Views.DueList) {
        self.list = list
        _filter = StoredFilter(list.screen)
    }

    var body: some View {
        let all = Views.dueDays(store.openTasks, today, list, in: store.timeZone)
        let shown = { (tasks: [TaskItem]) in ListFilters.filterTasks(tasks, filter, me: store.me) }
        let due = (
            overdue: shown(all.overdue),
            today: shown(all.today),
            days: all.days.map { (date: $0.date, tasks: shown($0.tasks)) }.filter { !$0.tasks.isEmpty }
        )
        let title = switch list {
        case .inbox: "Inbox"
        case .tomorrow: "Tomorrow"
        case .thisWeek: "This week"
        }
        let headed = list != .tomorrow
        let sections = [Markdown.Section(heading: "Overdue", tasks: due.overdue), .init(heading: "Today", tasks: due.today)]
            + due.days.map { Markdown.Section(heading: headed ? Format.dayHeading($0.date, today) : nil, tasks: $0.tasks) }
        TaskListScreen(
            title: title,
            isEmpty: all.overdue.isEmpty && all.today.isEmpty && all.days.isEmpty,
            emptyTitle: empty.title,
            emptyHint: empty.hint,
            root: true,
            open: due.overdue.count + due.today.count + due.days.reduce(0) { $0 + $1.tasks.count },
            header: ListHeaders.listHeader(list.header),
            actions: ListActions(noun: title, name: title, copy: {
                actions.copyAsMarkdown(Markdown.Document(title: title, sections: sections.filter { !$0.tasks.isEmpty }))
            }),
            filter: $filter,
            unfiltered: all.overdue + all.today + all.days.flatMap(\.tasks)
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
                } header: {
                    ListHeading(text: "Today", tasks: due.today, addTo: screen(on: today))
                }
            }
            ForEach(due.days, id: \.date) { group in
                if headed {
                    Section {
                        ForEach(group.tasks) { TaskRow(task: $0, showProject: $0.projectId != nil) }
                    } header: {
                        ListHeading(text: Format.dayHeading(group.date, today), tasks: group.tasks, addTo: screen(on: group.date))
                    }
                } else {
                    ForEach(group.tasks) { TaskRow(task: $0, showProject: $0.projectId != nil) }
                    GroupAddRow(group: title, addTo: screen(on: group.date))
                }
            }
        }
        .animation(.snappy, value: filter)
    }

    private var empty: (title: String, hint: String) {
        switch list {
        case .inbox: ("Nothing scheduled", "Tasks with a date show up here by day.")
        case .tomorrow: ("Nothing tomorrow", "Tasks due tomorrow show up here.")
        case .thisWeek: ("Nothing this week", "Tasks due by Sunday show up here by day.")
        }
    }

    private func screen(on date: DateKey) -> ListScreen {
        switch list {
        case .inbox: .inbox(date: date)
        case .tomorrow: .tomorrow
        case .thisWeek: .thisWeek(date: date)
        }
    }
}

/// Inbox tasks without a date, which would otherwise always sit at the bottom of Inbox, by when they were added, in one
/// list without sections.
struct NoDateScreen: View {
    @Environment(Store.self) private var store
    @Environment(TaskActions.self) private var actions
    @Environment(\.today) private var today
    @AppStorage("noDateNewestFirst") private var newestFirst = true
    @StoredFilter(.noDate) private var filter

    var body: some View {
        let all = Views.noDateTasks(store.openTasks, today, newestFirst: newestFirst, in: store.timeZone)
        let tasks = ListFilters.filterTasks(all, filter, me: store.me)
        TaskListScreen(
            title: "No date",
            isEmpty: all.isEmpty,
            emptyTitle: "Inbox zero",
            emptyHint: "Tap + to capture a task.",
            root: true,
            open: tasks.count,
            header: ListHeaders.listHeader(.noDate),
            actions: ListActions(
                noun: "No date",
                name: "No date",
                copy: { actions.copyAsMarkdown(Markdown.Document(title: "No date", sections: [.init(tasks: tasks)])) },
                newestFirst: $newestFirst
            ),
            filter: $filter,
            unfiltered: all
        ) {
            ForEach(tasks) { row($0) }
        }
        .animation(.snappy, value: newestFirst)
        .animation(.snappy, value: filter)
    }

    private func row(_ task: TaskItem) -> some View {
        TaskRow(task: task, added: Format.addedAgo(Dates.toDateKey(Date(timeIntervalSince1970: Double(task.createdAt) / 1000), in: store.timeZone), today))
    }
}

private extension Views.DueList {
    var screen: ListScreen {
        switch self {
        case .inbox: .inbox()
        case .tomorrow: .tomorrow
        case .thisWeek: .thisWeek()
        }
    }

    var header: ListHeaders.List {
        switch self {
        case .inbox: .inbox
        case .tomorrow: .tomorrow
        case .thisWeek: .thisWeek
        }
    }
}
