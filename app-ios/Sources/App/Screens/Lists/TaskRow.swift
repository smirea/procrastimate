import Core
import SwiftUI

/// A task in a list: a priority-tinted checkbox, the title, and a line of details. Leading swipe completes, trailing
/// swipe deletes, and tapping opens task details.
struct TaskRow: View {
    @Environment(Store.self) private var store
    @Environment(TaskActions.self) private var actions
    @Environment(Navigator.self) private var navigator
    @Environment(\.today) private var today
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    let task: TaskItem
    var showProject = false
    /// Within a day's list the date goes without saying, so a timed task shows only its time.
    var timeOnly = false

    @State private var checking = false

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Checkbox(checked: checking, tone: task.priority.tone) { check() }
                .accessibilityLabel("Complete \(task.title)")
                .accessibilityValue(Format.priorityLabel(task.priority))
            VStack(alignment: .leading, spacing: 2) {
                Text(task.title)
                    .font(.body)
                    .foregroundStyle(checking ? Color.faint : Color.ink)
                    .strikethrough(checking, color: .faint)
                    .lineLimit(1)
                if !task.notes.isEmpty {
                    Text(task.notes).font(.footnote).foregroundStyle(.muted).lineLimit(1)
                }
                details
            }
            .padding(.vertical, 11)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .contentShape(.rect)
            .onTapGesture { navigator.sheet = .details(taskID: task.id) }
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isButton)
            .accessibilityIdentifier("task-\(task.title)")
            .accessibilityAction { navigator.sheet = .details(taskID: task.id) }
        }
        .swipeActions(edge: .leading, allowsFullSwipe: true) {
            Button("Complete", systemImage: "checkmark") { actions.complete(task) }
                .tint(.toneToday)
        }
        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
            Button("Delete", systemImage: "trash", role: .destructive) { actions.delete(task) }
        }
        .contextMenu {
            Button("Complete", systemImage: "checkmark.circle") { actions.complete(task) }
            Button("Delete", systemImage: "trash", role: .destructive) { actions.delete(task) }
        }
    }

    /// The checkbox fills on the first frame, then the row leaves once the fill has played.
    private func check() {
        guard !checking else { return }
        checking = true
        Task {
            try? await Task.sleep(for: .milliseconds(reduceMotion ? 0 : 260))
            actions.complete(task)
            checking = false
        }
    }

    private var project: Project? { store.project(task.projectId) }
    private var labels: [Core.Label] { store.labels(of: task) }
    private var parent: TaskItem? { task.parentId.flatMap(store.task) }
    private var progress: Subtasks.Progress? {
        Subtasks.progressOf(store.tasks.filter { $0.parentId == task.id })
    }

    /// The day the task sits on, which for an event or a repeat at a place is not its stored due date.
    private var due: Due? { Triggers.scheduledDue(task, today, in: store.timeZone) }

    private var hasDetails: Bool {
        due != nil || task.location != nil || task.recurrence != nil || !task.reminders.isEmpty || progress != nil || !labels.isEmpty
            || parent != nil || showProject
    }

    @ViewBuilder private var details: some View {
        if hasDetails {
            HStack(spacing: 10) {
                if let event = task.event {
                    Detail(systemImage: "calendar", text: Triggers.formatEvent(event))
                        .foregroundStyle(due.map { Format.dueTone($0, today).color } ?? .muted)
                } else if let due, !(timeOnly && due.time == nil) {
                    Detail(
                        systemImage: "calendar",
                        text: timeOnly ? Format.formatTime(due.time!) : Format.formatDue(due, today)
                    )
                    .foregroundStyle(Format.dueTone(due, today).color)
                }
                if let location = task.location {
                    Detail(systemImage: "mappin.and.ellipse", text: Triggers.formatLocation(location))
                }
                if let recurrence = task.recurrence {
                    Image(systemName: "repeat")
                        .foregroundStyle(.toneTomorrow)
                        .accessibilityLabel(Format.repeatLabel(recurrence, due))
                }
                if let progress {
                    SubtaskProgress(progress: progress)
                }
                if !task.reminders.isEmpty {
                    Detail(systemImage: "bell", text: "\(task.reminders.count)")
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel("\(task.reminders.count) reminders")
                }
                ForEach(labels) { label in
                    LabelChip(name: label.name)
                }
                if let parent {
                    Detail(systemImage: "arrow.turn.down.right", text: parent.title)
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel("Subtask of \(parent.title)")
                }
                if showProject {
                    Spacer(minLength: 0)
                    Detail(systemImage: project == nil ? "tray" : "number", text: project?.name ?? "Inbox")
                }
            }
            .font(.caption)
            .foregroundStyle(.muted)
            .lineLimit(1)
        }
    }
}

/// An icon and a short text in a row's detail line.
private struct Detail: View {
    let systemImage: String
    let text: String

    var body: some View {
        HStack(spacing: 3) {
            Image(systemName: systemImage).imageScale(.small)
            Text(text)
        }
    }
}

struct LabelChip: View {
    let name: String

    var body: some View {
        HStack(spacing: 3) {
            Image(systemName: "tag.fill").imageScale(.small).foregroundStyle(.toneLabel)
            Text(name).foregroundStyle(.ink)
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 1)
        .background(.ink.opacity(0.05), in: .capsule)
        .transition(.scale(scale: 0.6).combined(with: .opacity))
    }
}

/// `done/total` with a ring, on a parent's row.
struct SubtaskProgress: View {
    let progress: Subtasks.Progress

    var body: some View {
        let complete = progress.done == progress.total
        HStack(spacing: 3) {
            ZStack {
                Circle().stroke(.secondary.opacity(0.25), lineWidth: 1.75)
                Circle()
                    .trim(from: 0, to: CGFloat(progress.done) / CGFloat(max(progress.total, 1)))
                    .stroke(style: StrokeStyle(lineWidth: 1.75, lineCap: .round))
                    .rotationEffect(.degrees(-90))
            }
            .frame(width: 10, height: 10)
            Text("\(progress.done)/\(progress.total)").monospacedDigit()
        }
        .foregroundStyle(complete ? Color.accent : Color.muted)
        .animation(.snappy, value: progress)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(progress.done) of \(progress.total) subtasks done")
    }
}

/// A round checkbox tinted by priority. It fills and pops when checked.
struct Checkbox: View {
    let checked: Bool
    let tone: Color
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack {
                Circle().fill(checked ? tone : tone.opacity(0.08))
                Circle().strokeBorder(tone, lineWidth: 1.5)
                Image(systemName: "checkmark")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(.white)
                    .scaleEffect(checked ? 1 : 0.4)
                    .opacity(checked ? 1 : 0)
            }
            .frame(width: 22, height: 22)
            .phaseAnimator([1.0, 1.18, 1.0], trigger: checked) { content, scale in
                content.scaleEffect(checked ? scale : 1)
            }
            .animation(.spring(duration: 0.26), value: checked)
            .frame(width: 44, height: 44)
            .contentShape(.circle)
        }
        .buttonStyle(.borderless)
        .padding(.leading, -11)
        .padding(.trailing, -6)
    }
}
