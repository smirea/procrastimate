import Core
import SwiftUI

struct TaskDetailsPage: View {
    @Environment(Store.self) private var store
    let taskID: String
    let navigation: DetailsNavigation

    var body: some View {
        if let task = store.task(taskID) {
            TaskDetailsForm(task: task, navigation: navigation)
                .environment(\.space, store.space(ofTask: task.id) ?? .own)
        }
    }
}

private struct TaskDetailsForm: View {
    @Environment(Store.self) private var store
    @Environment(TaskActions.self) private var actions
    @Environment(\.clock) private var clock
    @Environment(\.space) private var space

    let task: TaskItem
    let navigation: DetailsNavigation

    @State private var title: String
    @FocusState private var titleFocused: Bool
    @State private var keyboardShown = false
    @FocusState private var notesFocused: Bool

    init(task: TaskItem, navigation: DetailsNavigation) {
        self.task = task
        self.navigation = navigation
        _title = State(initialValue: task.title)
    }

    private var parent: TaskItem? { task.parentId.flatMap(store.task) }
    private var locked: Bool { store.isReadOnly(task.id) }

    var body: some View {
        let parsed = TaskDetails.parse(
            title,
            task,
            now: clock.now,
            projects: store.projects(in: space),
            sections: store.data(in: space).sections,
            labels: store.labels(in: space),
            in: clock.timeZone
        )
        let draft = TaskDetails.draft(task, title: title, parsed)
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let owner = store.owner(of: space) {
                    HStack(spacing: 6) {
                        Image(systemName: "person.2")
                        Text(locked ? "Shared by \(owner.name) · View only" : "Shared by \(owner.name)")
                    }
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(.muted)
                    .accessibilityElement(children: .combine)
                }

                // The insets are the text editor's own, so the linked text sits exactly where the raw text will.
                LinkedField(text: title, focused: $titleFocused, inset: EdgeInsets(top: 8, leading: 5, bottom: 8, trailing: 5)) {
                    SmartInput(
                        text: $title,
                        tokens: parsed.tokens,
                        label: "Title",
                        suggestProjects: parent == nil,
                        projectId: draft.projectId,
                        focused: $titleFocused,
                        onSubmit: { commitTitle() }
                    )
                    .disabled(locked)
                }
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
                    LocationChip(location: draft.location) { store.updateTask(task.id, TaskPatch(location: .some($0))) }
                    if task.event == nil { eventChip }
                    let labels = store.labels(in: space)
                    LabelsChip(labelIds: Triggers.pickedLabels(labels, labelIds: draft.labelIds, location: draft.location)) {
                        let applied = Triggers.applyPickedLabels(labels, $0, task.location)
                        store.updateTask(task.id, TaskPatch(labelIds: applied.labelIds, location: .some(applied.location)))
                    }
                }
                .animation(.snappy(duration: 0.16), value: draft)
                .disabled(locked)

                LinkedField(text: task.notes, focused: $notesFocused) {
                    TextField(
                        "Notes",
                        text: Binding(get: { task.notes }, set: { store.updateTask(task.id, TaskPatch(notes: $0)) }),
                        axis: .vertical
                    )
                    .lineLimit(3...)
                    .focused($notesFocused)
                    .disabled(locked)
                }
                .font(.subheadline)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(.ink.opacity(0.04), in: .rect(cornerRadius: 16))
                .accessibilityLabel("Notes")

                ImageStrip(task: task, locked: locked)

                if let memo = task.memoSource {
                    Link(destination: MemoTasks.memoURL(memo.memoId)) {
                        SwiftUI.Label("Notouroboros", systemImage: "waveform")
                            .font(.subheadline.weight(.medium))
                            .frame(minHeight: 44)
                    }
                }

                SubtaskList(task: task, navigation: navigation)

                TaskComments(task: task)

                // No spacing here: people adds its own gap only when it shows, so a solo task has no empty slot.
                VStack(alignment: .leading, spacing: 0) {
                    TaskPeople(task: task)

                    Button {
                        commitTitle()
                        actions.copyAsMarkdown(store.task(task.id) ?? task)
                    } label: {
                        SwiftUI.Label("Copy as Markdown", systemImage: "doc.on.doc")
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(.muted)
                            .frame(minHeight: 44)
                    }
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
            // Clears the floating Complete and Delete buttons at the end of a long task. They hide while typing, so the
            // end of the task then sits just above the keyboard.
            .padding(.bottom, keyboardShown ? 16 : 120)
        }
        .scrollDismissesKeyboard(.interactively)
        // The subtask rows swipe outside a `List`, so the page gives them a list's closing on outside taps and scrolls.
        .swipeActionsContainer()
        .overlay(alignment: .bottom) { if !locked { floatingActions } }
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
                .foregroundStyle(tint)
                .padding(.horizontal, 20)
                .frame(minHeight: 52)
                .contentShape(.capsule)
                .glassEffect(.regular.interactive(), in: .capsule)
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
                ProjectMenu(projectId: draft.projectId, sectionId: draft.sectionId) { projectId, sectionId in
                    store.updateTask(task.id, TaskPatch(projectId: .some(projectId), sectionId: .some(sectionId)))
                }
                .disabled(locked)
            }
        }
        if space == .own {
            ToolbarItem(placement: .topBarTrailing) {
                ShareButton(target: API.ShareTarget(kind: .task, id: task.id), name: task.title)
                    .labelStyle(.iconOnly)
            }
        }
        ToolbarItem(placement: .topBarTrailing) {
            Button(role: .close) { navigation.close() }
                .accessibilityLabel("Close")
        }
    }

    private func commitTitle() {
        guard !locked else { return }
        let parsed = TaskDetails.parse(
            title,
            task,
            now: clock.now,
            projects: store.projects(in: space),
            sections: store.data(in: space).sections,
            labels: store.labels(in: space),
            in: clock.timeZone
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
    let sectionId: String?
    let labelIds: [String]
    let reminders: [Reminder]
    let location: TaskLocation?
    let event: TaskEvent?

    init(_ task: TaskItem) {
        due = task.due
        recurrence = task.recurrence
        priority = task.priority
        projectId = task.projectId
        sectionId = task.sectionId
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
    let sectionId: String?
    let onChange: @MainActor (String?, String?) -> Void

    @State private var creating = false

    var body: some View {
        let name = store.placeName(projectId, sectionId)
        Menu {
            PlaceMenuContent(
                selection: Binding(
                    get: { Place(projectId: projectId, sectionId: sectionId) },
                    set: { onChange($0.projectId, $0.sectionId) }
                ),
                creating: $creating
            )
        } label: {
            // Only the share and close buttons share the bar, so the name gets most of the width and truncates.
            HStack(spacing: 6) {
                Image(systemName: projectId == nil ? "tray" : "number")
                Text(name).lineLimit(1).truncationMode(.tail)
            }
            .frame(maxWidth: 240, alignment: .leading)
        }
        .accessibilityLabel("Project \(name)")
        .newProjectPrompt(isPresented: $creating) { onChange($0, nil) }
        .accessibilityIdentifier("Project menu")
    }
}
