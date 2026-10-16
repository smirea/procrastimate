import Core
import SwiftUI

struct LabelScreen: View {
    @Environment(Store.self) private var store
    @Environment(Navigator.self) private var navigator
    @Environment(TaskActions.self) private var actions
    let labelID: String

    @State private var name: String?
    @AppStorage("showCompleted") private var showCompleted = false

    var body: some View {
        if let label = store.label(labelID) {
            let space = store.space(ofLabel: label.id) ?? .own
            let all = store.data(in: space).tasks
            let tasks = Views.labelTasks(all, label.id, in: store.timeZone)
            let done = showCompleted
                ? Views.completedTasks(all.filter { $0.labelIds.contains(label.id) }, .init(), in: store.timeZone) : []
            TaskListScreen(
                title: label.name,
                isEmpty: tasks.isEmpty && !showCompleted,
                emptyTitle: "No tasks with this label",
                emptyHint: Browse.labelEmptyHint(label.name),
                labelColor: label.color
            ) {
                ForEach(tasks) { TaskRow(task: $0, showProject: true) }
                if showCompleted { CompletedSection(tasks: done, showProject: true) }
            }
            .animation(.snappy, value: showCompleted)
            .environment(\.space, space)
            .nameActions(
                noun: "label",
                name: label.name,
                space: space,
                share: API.ShareTarget(kind: .label, id: label.id),
                deletePrompt: Browse.deleteLabelPrompt(label.name),
                deleteMessage: Browse.deleteLabelMessage,
                copy: { actions.copyAsMarkdown(Markdown.Document(title: label.name, sections: [.init(tasks: tasks)])) },
                rename: { store.renameLabel(label.id, $0) },
                color: label.color,
                recolor: { store.setLabelColor(label.id, $0) },
                delete: { store.deleteLabel(label.id) }
            )
            .task(id: label.name) { name = label.name }
        } else {
            // Sync merges a label into the oldest one with its name, so the screen follows the name there.
            Color.clear.task {
                let survivor = name.flatMap { name in store.labels.first { $0.name.lowercased() == name.lowercased() } }
                navigator.replace(.label(id: labelID), with: survivor.map { .label(id: $0.id) })
            }
        }
    }
}
