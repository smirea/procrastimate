import Core
import SwiftUI

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
    @State private var keyboardShown = false

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
                    if task.event != nil {
                        eventChip
                    } else {
                        DueChip(due: draft.due) { store.updateTask(task.id, TaskDetails.setDue(task, $0)) }
                        RepeatChip(recurrence: draft.recurrence, due: draft.due) { recurrence, due in
                            store.updateTask(task.id, TaskPatch(due: .some(due), recurrence: .some(recurrence)))
                        }
                    }
                    PriorityChip(priority: draft.priority) {
                        store.updateTask(task.id, TaskPatch(priority: $0))
                    }
                    ReminderChip(
                        reminders: draft.reminders,
                        due: task.event == nil ? draft.due : Triggers.scheduledDue(task, clock.today, in: clock.timeZone),
                        relativeOnly: task.event != nil
                    ) {
                        store.updateTask(task.id, TaskPatch(reminders: $0))
                    }
                    LocationChip(location: task.location) { store.updateTask(task.id, TaskPatch(location: .some($0))) }
                    if task.event == nil { eventChip }
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

                if let memo = task.memoSource {
                    Link(destination: MemoTasks.memoURL(memo.memoId)) {
                        SwiftUI.Label("NoteTorus", systemImage: "waveform")
                            .font(.subheadline.weight(.medium))
                            .frame(minHeight: 44)
                    }
                }

                SubtaskList(task: task, navigation: navigation)
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
            // Clears the floating Complete and Delete buttons at the end of a long task.
            .padding(.bottom, 120)
        }
        .scrollDismissesKeyboard(.interactively)
        .overlay(alignment: .bottom) { floatingActions }
        .onMessage(of: UIScreen.self, for: .keyboardWillShow) { _ in keyboardShown = true }
        .onMessage(of: UIScreen.self, for: .keyboardWillHide) { _ in keyboardShown = false }
        .background(.canvas)
        .navigationTitle("Task details")
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden()
        .toolbar { toolbar(draft) }
        .sensoryFeedback(.selection, trigger: Picks(task))
        .onChange(of: titleFocused) { if !titleFocused { commitTitle() } }
        .onDisappear { commitTitle() }
    }

    /// Hidden while typing so they never cover the field above the keyboard.
    private var floatingActions: some View {
        HStack {
            if task.completedAt == nil {
                floatingButton("Complete", systemImage: "checkmark", tint: .toneSoon) { complete() }
            } else {
                floatingButton("Reopen", systemImage: "arrow.counterclockwise", tint: .accent) { store.reopenTask(task.id) }
            }
            Spacer()
            floatingButton("Delete", systemImage: "trash", tint: .toneOverdue) { delete() }
                .accessibilityLabel("Delete task")
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 12)
        .opacity(keyboardShown ? 0 : 1)
        .allowsHitTesting(!keyboardShown)
        .animation(.snappy(duration: 0.2), value: keyboardShown)
    }

    private func floatingButton(_ title: String, systemImage: String, tint: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            SwiftUI.Label(title, systemImage: systemImage)
                .font(.body.weight(.semibold))
                .foregroundStyle(.white)
                .padding(.horizontal, 20)
                .frame(minHeight: 52)
                .contentShape(.capsule)
                .glassEffect(.regular.tint(tint).interactive(), in: .capsule)
        }
        .buttonStyle(.plain)
    }

    /// An event stands in for the date, so it takes the date chip's place, and linking one drops the due date and the
    /// repeat.
    private var eventChip: some View {
        EventChip(event: task.event) { event in
            store.updateTask(
                task.id,
                event == nil ? TaskPatch(event: .some(nil)) : TaskPatch(due: .some(nil), recurrence: .some(nil), event: .some(event))
            )
        }
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
    let location: TaskLocation?
    let event: TaskEvent?

    init(_ task: TaskItem) {
        due = task.due
        recurrence = task.recurrence
        priority = task.priority
        projectId = task.projectId
        labelIds = task.labelIds
        reminders = task.reminders
        location = task.location
        event = task.event
    }
}

/// The project picker in a top-level task's toolbar. A subtask shares its root's project, so it shows a back chip
/// instead.
private struct ProjectMenu: View {
    @Environment(Store.self) private var store
    let projectId: String?
    let onChange: @MainActor (String?) -> Void

    @State private var creating = false

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
            Button("New project…", systemImage: "plus") { creating = true }
        } label: {
            // The close button is the only other item in the bar, so the name gets the rest of the width and truncates.
            HStack(spacing: 6) {
                Image(systemName: project == nil ? "tray" : "number")
                Text(project?.name ?? "Inbox").lineLimit(1).truncationMode(.tail)
            }
            .frame(maxWidth: 240, alignment: .leading)
        }
        .accessibilityLabel("Project \(project?.name ?? "Inbox")")
        .newProjectPrompt(isPresented: $creating) { onChange($0) }
        .accessibilityIdentifier("Project menu")
    }
}
