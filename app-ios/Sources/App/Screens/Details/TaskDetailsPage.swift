import Core
import SwiftUI

/// One task's details: the title, which parses like quick add and applies on return or when it loses focus, the chips
/// that spell out what it will apply, labels, notes, subtasks, and delete. Every other change saves as it is made.
struct TaskDetailsPage: View {
    @Environment(Store.self) private var store
    let taskID: String
    let navigation: DetailsNavigation

    var body: some View {
        if let task = store.task(taskID) {
            TaskDetailsForm(task: task, navigation: navigation)
        }
    }
}

private struct TaskDetailsForm: View {
    @Environment(Store.self) private var store
    @Environment(TaskActions.self) private var actions
    @Environment(\.clock) private var clock

    let task: TaskItem
    let navigation: DetailsNavigation

    @State private var title: String
    @FocusState private var titleFocused: Bool

    init(task: TaskItem, navigation: DetailsNavigation) {
        self.task = task
        self.navigation = navigation
        _title = State(initialValue: task.title)
    }

    private var parent: TaskItem? { task.parentId.flatMap(store.task) }

    var body: some View {
        let parsed = TaskDetails.parse(
            title, task, now: clock.now, projects: store.projects, labels: store.labels, in: clock.timeZone
        )
        let draft = TaskDetails.draft(task, title: title, parsed)
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                SmartInput(
                    text: $title,
                    tokens: parsed.tokens,
                    label: "Title",
                    suggestProjects: parent == nil,
                    focused: $titleFocused,
                    onSubmit: { commitTitle() }
                )
                .font(.title3.weight(.semibold))

                FlowLayout(spacing: 6) {
                    DueChip(due: draft.due, onKeepAsText: nil) { store.updateTask(task.id, TaskDetails.setDue(task, $0)) }
                    RepeatChip(recurrence: draft.recurrence, due: draft.due) { recurrence, due in
                        store.updateTask(task.id, TaskPatch(due: .some(due), recurrence: .some(recurrence)))
                    }
                    PriorityChip(priority: draft.priority, onKeepAsText: nil) {
                        store.updateTask(task.id, TaskPatch(priority: $0))
                    }
                    ReminderChip(reminders: draft.reminders, due: draft.due) {
                        store.updateTask(task.id, TaskPatch(reminders: $0))
                    }
                    LabelsChip(labelIds: draft.labelIds) { store.updateTask(task.id, TaskPatch(labelIds: $0)) }
                }
                .animation(.snappy(duration: 0.16), value: draft)

                TextField(
                    "Notes",
                    text: Binding(get: { task.notes }, set: { store.updateTask(task.id, TaskPatch(notes: $0)) }),
                    axis: .vertical
                )
                .lineLimit(3...)
                .font(.subheadline)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(.ink.opacity(0.04), in: .rect(cornerRadius: 16))
                .accessibilityLabel("Notes")

                SubtaskList(task: task, navigation: navigation)

                Button(role: .destructive) { delete() } label: {
                    SwiftUI.Label("Delete task", systemImage: "trash")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(.toneOverdue)
                        .frame(minHeight: 44)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
            .padding(.bottom, 80)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(.canvas)
        .navigationTitle("Task details")
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden()
        .toolbar { toolbar(draft) }
        .sensoryFeedback(.selection, trigger: Picks(task))
        .onChange(of: titleFocused) { if !titleFocused { commitTitle() } }
        .onDisappear { commitTitle() }
    }

    @ToolbarContentBuilder
    private func toolbar(_ draft: TaskDetails.Draft) -> some ToolbarContent {
        // The title field already names the task, so the bar shows no title; UI tests find the bar by it.
        ToolbarItem(placement: .principal) { Color.clear.frame(width: 1, height: 1).accessibilityHidden(true) }
        ToolbarItem(placement: .topBarLeading) {
            if let parent {
                Button { navigation.back(parent.id) } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "chevron.left").font(.subheadline.weight(.semibold))
                        Text(parent.title).lineLimit(1)
                    }
                    .frame(maxWidth: 180, alignment: .leading)
                }
                .accessibilityLabel("Back to \(parent.title)")
            } else {
                ProjectMenu(projectId: draft.projectId) { store.updateTask(task.id, TaskPatch(projectId: .some($0))) }
            }
        }
        ToolbarItemGroup(placement: .topBarTrailing) {
            if task.completedAt == nil {
                Button("Complete", systemImage: "checkmark") { complete() }
                    .labelStyle(.titleAndIcon)
            } else {
                Button("Reopen", systemImage: "arrow.counterclockwise") { store.reopenTask(task.id) }
                    .labelStyle(.titleAndIcon)
            }
        }
        ToolbarSpacer(.fixed, placement: .topBarTrailing)
        ToolbarItem(placement: .topBarTrailing) {
            Button(role: .close) { navigation.close() }
                .accessibilityLabel("Close")
        }
    }

    private func commitTitle() {
        let parsed = TaskDetails.parse(
            title, task, now: clock.now, projects: store.projects, labels: store.labels, in: clock.timeZone
        )
        switch TaskDetails.commitTitle(task, title: title, parsed) {
        case .unchanged:
            break
        case .revert:
            title = task.title
        case let .update(patch, next):
            withAnimation(.snappy) { store.updateTask(task.id, patch) }
            title = next
        }
    }

    private func complete() {
        commitTitle()
        let parentID = task.parentId
        actions.complete(task)
        navigation.leave(parentID)
    }

    private func delete() {
        let parentID = task.parentId
        navigation.leave(parentID)
        actions.delete(task)
    }
}

/// The fields a picker sets, so a pick plays the selection haptic and typing never does.
private struct Picks: Equatable {
    let due: Due?
    let recurrence: Recurrence?
    let priority: Priority
    let projectId: String?
    let labelIds: [String]
    let reminders: [Reminder]

    init(_ task: TaskItem) {
        due = task.due
        recurrence = task.recurrence
        priority = task.priority
        projectId = task.projectId
        labelIds = task.labelIds
        reminders = task.reminders
    }
}

/// The project picker in a top-level task's toolbar. A subtask shares its root's project, so it shows a back chip
/// instead.
private struct ProjectMenu: View {
    @Environment(Store.self) private var store
    let projectId: String?
    let onChange: (String?) -> Void

    var body: some View {
        let project = store.project(projectId)
        Menu {
            Picker("Project", selection: Binding(get: { project?.id }, set: onChange)) {
                SwiftUI.Label("Inbox", systemImage: "tray").tag(String?.none)
                ForEach(store.projects) { project in
                    SwiftUI.Label(project.name, systemImage: "number").tag(String?.some(project.id))
                }
            }
            .pickerStyle(.inline)
        } label: {
            SwiftUI.Label(project?.name ?? "Inbox", systemImage: project == nil ? "tray" : "number")
                .labelStyle(.titleAndIcon)
                .lineLimit(1)
        }
        .accessibilityLabel("Project \(project?.name ?? "Inbox")")
        .accessibilityIdentifier("Project menu")
    }
}
