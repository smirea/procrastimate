import Core
import Feetback
import SwiftUI

struct LabelScreen: View {
    @Environment(Store.self) private var store
    @Environment(Navigator.self) private var navigator
    @Environment(TaskActions.self) private var actions
    @Environment(\.today) private var today
    let labelID: String

    @State private var editingPlace = false
    @AppStorage private var showCompleted: Bool
    @StoredFilter private var filter: ListFilter

    init(labelID: String) {
        self.labelID = labelID
        _showCompleted = .showCompleted(API.ShareTarget(kind: .label, id: labelID))
        _filter = StoredFilter(.label(id: labelID))
    }

    var body: some View {
        if let label = store.label(labelID) {
            let space = store.space(ofLabel: label.id) ?? .own
            let all = store.data(in: space).tasks
            let unfiltered = Views.labelViewTasks(all, label, in: store.timeZone)
            let shown = { (tasks: [TaskItem]) in ListFilters.filterTasks(tasks, filter, me: store.me) }
            let tasks = shown(unfiltered)
            let listed = Screens.listed(.label(id: label.id), store.labels)
            let done = showCompleted
                ? shown(Views.completedTasks(
                    all.filter { Screens.holds(listed, $0, today, in: store.timeZone) },
                    .init(),
                    in: store.timeZone
                )) : []
            TaskListScreen(
                title: label.name,
                isEmpty: unfiltered.isEmpty && !showCompleted,
                emptyTitle: label.place == nil ? "No tasks with this label" : "No tasks at this place",
                emptyHint: Browse.labelEmptyHint(label.name),
                labelColor: label.color,
                labelIcon: label.systemImage(filled: true),
                open: tasks.count,
                header: ListHeaders.listHeader(.label(own: space == .own, place: label.place != nil)),
                actions: ListActions(
                    noun: label.place == nil ? "label" : "place",
                    name: label.name,
                    copy: { actions.copyAsMarkdown(Markdown.Document(title: label.name, sections: [.init(tasks: tasks)])) },
                    share: API.ShareTarget(kind: .label, id: label.id),
                    showCompleted: $showCompleted,
                    rename: { store.renameLabel(label.id, $0) },
                    color: Binding(get: { label.color }, set: { store.setLabelColor(label.id, $0) }),
                    editPlace: { editingPlace = true },
                    delete: .init(
                        prompt: Browse.deleteLabelPrompt(label.name),
                        message: label.place == nil ? Browse.deleteLabelMessage : Browse.deletePlaceMessage
                    ) { store.deleteLabel(label.id) }
                ),
                filter: $filter,
                unfiltered: unfiltered
            ) {
                ForEach(tasks) { TaskRow(task: $0, showProject: true) }
                if showCompleted { CompletedSection(tasks: done, showProject: true) }
            }
            .animation(.snappy, value: showCompleted)
            .environment(\.space, space)
            .sheet(isPresented: $editingPlace) { PlaceSheet(mode: .edit(label)) }
            .animation(.snappy, value: filter)
            .navigationSubtitle(store.owner(of: space).map { "Shared by \($0.name)" } ?? "")
            .feedback(self)
        } else {
            Color.clear.task { navigator.drop(.label(id: labelID)) }
        }
    }
}
