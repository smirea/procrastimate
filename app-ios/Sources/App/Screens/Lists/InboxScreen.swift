import Core
import SwiftUI

struct InboxScreen: View {
    @Environment(Store.self) private var store

    var body: some View {
        let tasks = Views.inboxTasks(store.tasks, in: store.timeZone)
        TaskListScreen(
            title: "Inbox",
            isEmpty: tasks.isEmpty,
            emptyTitle: "Inbox zero",
            emptyHint: "Tap + to capture a task.",
            quickAdd: QuickAddDefaults()
        ) {
            ForEach(tasks) { TaskRow(task: $0) }
        }
    }
}
