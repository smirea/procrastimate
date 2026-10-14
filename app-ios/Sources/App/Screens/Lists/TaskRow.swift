import Core
import SwiftUI

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
    @State private var postponing = false

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
            .padding(.vertical, 6)
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
            // An event task's day comes from its calendar event, so there is nothing to move.
            if task.event == nil {
                Button("Postpone", systemImage: "calendar.badge.clock") { postponing = true }
                    .tint(.toneWeek)
            }
        }
        .confirmationDialog("Postpone “\(task.title)”", isPresented: $postponing, titleVisibility: .visible) {
            ForEach(Format.postponeOptions(task.due, today), id: \.date) { option in
                Button("\(option.label) · \(Format.weekdayNames[Dates.weekdayOf(option.date)])") {
                    actions.postpone(task, to: option.date)
                }
            }
            Button("Pick a date…") { navigator.sheet = .details(taskID: task.id) }
        }
        .contextMenu {
            Button("Complete", systemImage: "checkmark.circle") { actions.complete(task) }
            if task.event == nil {
                Menu("Postpone", systemImage: "calendar.badge.clock") {
                    ForEach(Format.postponeOptions(task.due, today), id: \.date) { option in
                        Button(option.label) { actions.postpone(task, to: option.date) }
                    }
                }
            }
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
                    EventDetail(
                        label: Triggers.eventLabel(event, today, in: store.timeZone),
                        series: event.series,
                        tone: due.map { Format.dueTone($0, today).color } ?? .muted
                    )
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

/// `4:15pm ([repeat] 15m after [calendar] Standup)`: the task's moment in its due tone, then the event in gray. The
/// repeat icon, as on a repeating task, marks a task that follows the series.
private struct EventDetail: View {
    let label: Triggers.EventLabel
    let series: Bool
    let tone: Color

    var body: some View {
        let repeats = series ? Text("\(Image(systemName: "repeat")) ") : Text("")
        let meta = Text("\(repeats)\(label.lead) \(Image(systemName: "calendar")) \(label.title)")
        Group {
            if let when = label.when {
                Text("\(Text(when).foregroundStyle(tone)) \(Text("(\(meta))").foregroundStyle(.muted))")
            } else {
                meta.foregroundStyle(.muted)
            }
        }
        .imageScale(.small)
        .accessibilityLabel(
            [label.when, "\(label.lead) \(series ? "every " : "")\(label.title)"].compactMap { $0 }.joined(separator: ", ")
        )
    }
}

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
