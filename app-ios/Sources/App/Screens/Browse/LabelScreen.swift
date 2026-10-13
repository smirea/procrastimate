import Core
import SwiftUI

/// Every open task with the label, across projects, each naming its project. Quick add here starts with the label.
struct LabelScreen: View {
    @Environment(Store.self) private var store
    let labelID: String

    var body: some View {
        if let label = store.label(labelID) {
            let tasks = Views.labelTasks(store.tasks, label.id, in: store.timeZone)
            TaskListScreen(
                title: label.name,
                isEmpty: tasks.isEmpty,
                emptyTitle: "No tasks with this label",
                emptyHint: Browse.labelEmptyHint(label.name),
                quickAdd: QuickAddDefaults(labelId: label.id)
            ) {
                ForEach(tasks) { TaskRow(task: $0, showProject: true) }
            }
            .nameActions(
                noun: "label",
                name: label.name,
                deletePrompt: Browse.deleteLabelPrompt(label.name),
                deleteMessage: Browse.deleteLabelMessage,
                rename: { store.renameLabel(label.id, $0) },
                delete: { store.deleteLabel(label.id) }
            )
        } else {
            ContentUnavailableView("This label no longer exists.", systemImage: "tag")
        }
    }
}
