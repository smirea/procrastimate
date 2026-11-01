import Core
import SwiftUI

/// A completed task: when it was completed, who did it when that was someone else, and a filled checkbox that reopens
/// it. A repeating task is still open after a roll, so its checkbox only shows the completion.
struct CompletedRow: View {
    @Environment(Store.self) private var store
    @Environment(TaskActions.self) private var actions
    @Environment(Navigator.self) private var navigator
    @Environment(\.today) private var today
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    let task: TaskItem
    var showProject = false

    @State private var reopening = false

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Checkbox(checked: !reopening, tone: task.priority.tone) { reopen() }
                .accessibilityLabel(canReopen ? "Reopen \(task.title)" : "Completed \(task.title)")
                .disabled(!canReopen)
            VStack(alignment: .leading, spacing: 2) {
                Links.text(task.title)
                    .font(.body)
                    .foregroundStyle(reopening ? Color.ink : Color.muted)
                    .strikethrough(!reopening, color: .faint)
                    .lineLimit(1)
                details
            }
            .padding(.vertical, 6)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .contentShape(.rect)
            .onTapGesture { navigator.sheet = .details(taskID: task.id) }
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isButton)
            .accessibilityIdentifier("completed-\(task.title)")
            .accessibilityAction { navigator.sheet = .details(taskID: task.id) }
        }
        .taskSwipes(task, offered, toggle: { actions.reopen(task) }, pickDate: {})
        .contextMenu { TaskMenu(task: task, offered: offered, toggle: { actions.reopen(task) }) }
    }

    private var rolled: Bool { task.completedAt == nil }
    private var offered: RowActions { RowActions(task, in: store, rolled: rolled) }
    private var canReopen: Bool { offered.toggle != nil }
    private var parent: TaskItem? { task.parentId.flatMap(store.task) }
    private var project: Project? { store.project(task.projectId) }
    private var progress: Subtasks.Progress? { Subtasks.progressOf(store.children(of: task.id), parentDone: !rolled) }

    /// A null `completedBy` is a completion from before the server stamped them, or one not synced yet, so it names no one.
    private var completedBy: Person? {
        guard let id = task.completedBy, id != store.me else { return nil }
        return store.person(id) ?? Person(id: id, name: "Someone", kind: .human)
    }

    /// The fill clears on the first frame, then the row leaves once it has played.
    private func reopen() {
        guard canReopen, !reopening else { return }
        reopening = true
        Task {
            try? await Task.sleep(for: .milliseconds(reduceMotion ? 0 : 260))
            actions.reopen(task)
            reopening = false
        }
    }

    private var details: some View {
        HStack(spacing: 10) {
            if let at = Views.completedMoment(task) {
                Text(Format.completedWhen(Date(epochMilliseconds: at), today, in: store.timeZone))
            }
            if rolled {
                Image(systemName: "repeat")
                    .foregroundStyle(.toneRepeat)
                    .accessibilityLabel("Repeats")
            }
            if let completedBy {
                HStack(spacing: 3) {
                    Text("by")
                    PersonName(person: completedBy).foregroundStyle(.ink)
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Completed by \(completedBy.name)")
            }
            if let progress {
                SubtaskProgress(progress: progress)
            }
            if let parent {
                HStack(spacing: 3) {
                    Image(systemName: "arrow.turn.down.right").imageScale(.small)
                    Text(parent.title)
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Subtask of \(parent.title)")
            }
            if showProject {
                Spacer(minLength: 0)
                HStack(spacing: 3) {
                    Image(systemName: project?.systemImage ?? "tray").imageScale(.small)
                    Text(project?.name ?? "Inbox")
                }
            }
        }
        .font(.caption)
        .foregroundStyle(.muted)
        .lineLimit(1)
    }
}

/// A label's completed tasks under its open ones, all time and newest first, or a project's whose section is gone.
struct CompletedSection: View {
    let tasks: [TaskItem]
    var showProject = false

    var body: some View {
        Section {
            if tasks.isEmpty {
                Text("Nothing completed yet.")
                    .font(.subheadline)
                    .foregroundStyle(.faint)
                    .padding(.vertical, 8)
            }
            ForEach(tasks) { CompletedRow(task: $0, showProject: showProject) }
        } header: {
            ListHeading(text: "Completed", tone: .muted, tasks: tasks, counted: false)
        }
    }
}
