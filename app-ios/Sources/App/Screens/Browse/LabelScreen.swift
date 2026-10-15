import Core
import SwiftUI

struct LabelScreen: View {
    @Environment(Store.self) private var store
    let labelID: String

    var body: some View {
        if let label = store.label(labelID) {
            let space = store.space(ofLabel: label.id) ?? .own
            let tasks = Views.labelTasks(store.data(in: space).tasks, label.id, in: store.timeZone)
            TaskListScreen(
                title: label.name,
                isEmpty: tasks.isEmpty,
                emptyTitle: "No tasks with this label",
                emptyHint: Browse.labelEmptyHint(label.name)
            ) {
                ForEach(tasks) { TaskRow(task: $0, showProject: true) }
            }
            .environment(\.space, space)
            .nameActions(
                noun: "label",
                name: label.name,
                space: space,
                share: API.ShareTarget(kind: .label, id: label.id),
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
