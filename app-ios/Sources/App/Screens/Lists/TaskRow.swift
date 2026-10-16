import Core
import SwiftUI

/// Where a row sits. A list row leaves once checked, with an undo toast. A subtask row in its parent's details stays
/// when done and toggles in place with no toast, since the checkbox is its own undo, opens by pushing, and wraps its
/// whole title.
enum TaskRowPlacement {
    case list
    case subtask(open: () -> Void)
}

struct TaskRow<Trailing: View>: View {
    @Environment(Store.self) private var store
    @Environment(TaskActions.self) private var actions
    @Environment(Navigator.self) private var navigator
    @Environment(\.today) private var today
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    let task: TaskItem
    var showProject = false
    /// Within a day's list the date goes without saying, so a timed task shows only its time.
    var timeOnly = false
    /// No date shows how long ago each task was added, such as `3 days ago`.
    var added: String?
    var placement = TaskRowPlacement.list
    @ViewBuilder var trailing: Trailing

    @State private var checking = false
    @State private var postponing = false

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            row
            trailing
        }
        .swipeActions(edge: .leading, when: swipes.toggle != nil) {
            if let toggle = swipes.toggle {
                Button(toggle.label, systemImage: toggle.systemImage) { completeNow() }
                    .tint(.toneSoon)
            }
        }
        .swipeActions(edge: .trailing, when: swipes.postpone) {
            Button("Postpone", systemImage: "calendar.badge.clock") { postponing = true }
                .tint(.toneWeek)
        }
        .confirmationDialog("Postpone “\(task.title)”", isPresented: $postponing, titleVisibility: .visible) {
            ForEach(Format.postponeOptions(due, today), id: \.date) { option in
                Button("\(option.label) · \(Format.weekdayNames[Dates.weekdayOf(option.date)])") {
                    actions.postpone(task, to: option.date)
                }
            }
            Button("Pick a date…") { open() }
        }
        // Outside a `List`, as in task details, swipe actions keep the buttons and closures they were first built with,
        // so the row rebuilds whenever what they offer changes.
        .id(swipes)
    }

    private var row: some View {
        HStack(alignment: .top, spacing: 10) {
            Checkbox(checked: checking || done, tone: task.priority.tone) { check() }
                .accessibilityLabel("Complete \(task.title)")
                .accessibilityValue(Format.priorityLabel(task.priority))
                .accessibilityAddTraits(done ? .isSelected : [])
                .disabled(locked)
            VStack(alignment: .leading, spacing: 2) {
                TitleFlow(
                    title: Links.attributed(task.title),
                    labels: labels.map { TitleFlow.Chip(text: AttributedString($0.name), color: $0.color) },
                    done: checking || done,
                    lineLimit: isSubtask ? nil : 2
                )
                .font(.body)
                if !task.notes.isEmpty {
                    Text(Links.attributed(task.notes)).font(.footnote).foregroundStyle(.muted).lineLimit(1)
                }
                details
            }
            .padding(.vertical, 6)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .contentShape(.rect)
            // A tap gesture rather than a Button, which would swallow taps on a link in the title.
            .onTapGesture { open() }
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isButton)
            .accessibilityIdentifier(isSubtask ? "subtask-\(task.title)" : "task-\(task.title)")
            .accessibilityAction { open() }
            if let added {
                Text(added)
                    .font(.caption)
                    .foregroundStyle(.faint)
                    .lineLimit(1)
                    .fixedSize()
                    .padding(.top, 9)
                    .accessibilityLabel("Added \(added.lowercased())")
            }
        }
        .background {
            RoundedRectangle(cornerRadius: 14)
                .fill(.accent.opacity(navigator.revealed == task.id ? 0.14 : 0))
                .padding(.horizontal, -8)
                .animation(.easeOut(duration: 0.6), value: navigator.revealed == task.id)
        }
        .contextMenu {
            if !locked {
                Button(done ? "Reopen" : "Complete", systemImage: done ? "arrow.uturn.backward.circle" : "checkmark.circle") { completeNow() }
                if task.event == nil && !done {
                    Menu("Postpone", systemImage: "calendar.badge.clock") {
                        ForEach(Format.postponeOptions(due, today), id: \.date) { option in
                            Button(option.label) { actions.postpone(task, to: option.date) }
                        }
                    }
                }
                Button("Delete", systemImage: "trash", role: .destructive) { actions.delete(task) }
            }
            Button("Copy as Markdown", systemImage: "doc.on.doc") { actions.copyAsMarkdown(task) }
        }
    }

    /// A list row's checkbox fills on the first frame, then the row leaves once the fill has played.
    private func check() {
        if isSubtask {
            withAnimation(reduceMotion ? nil : .snappy) {
                if done { store.reopenTask(task.id) } else { _ = store.completeTask(task.id) }
            }
            return
        }
        guard !checking else { return }
        checking = true
        Task {
            try? await Task.sleep(for: .milliseconds(reduceMotion ? 0 : 260))
            actions.complete(task)
            checking = false
        }
    }

    /// A swipe or menu has no checkbox fill to wait for.
    private func completeNow() {
        if isSubtask { check() } else { actions.complete(task) }
    }

    private func open() {
        switch placement {
        case .list: navigator.sheet = .details(taskID: task.id)
        case .subtask(let open): open()
        }
    }

    private var isSubtask: Bool {
        if case .subtask = placement { true } else { false }
    }

    private var done: Bool { task.completedAt != nil }

    /// Everything the swipe buttons show and do, so the row's identity can follow it.
    private struct Swipes: Hashable {
        enum Toggle: Hashable {
            case complete, reopen
            var label: String { self == .complete ? "Complete" : "Reopen" }
            var systemImage: String { self == .complete ? "checkmark" : "arrow.uturn.backward" }
        }

        let toggle: Toggle?
        let postpone: Bool
    }

    /// An event task's day comes from its calendar event, so there is nothing to postpone.
    private var swipes: Swipes {
        Swipes(toggle: locked ? nil : done ? .reopen : .complete, postpone: task.event == nil && !locked && !done)
    }
    private var locked: Bool { store.isReadOnly(task.id) }
    private var project: Project? { store.project(task.projectId) }
    private var labels: [Core.Label] { store.labels(of: task) }
    private var parent: TaskItem? { isSubtask ? nil : task.parentId.flatMap(store.task) }
    private var progress: Subtasks.Progress? {
        Subtasks.progressOf(store.allTasks.filter { $0.parentId == task.id })
    }
    private var commentBadge: CommentBadge? { store.commentBadge(task.id, me: Session.userID) }

    /// The day the task sits on, which for an event or a repeat at a place is not its stored due date.
    private var due: Due? { done ? nil : Triggers.scheduledDue(task, today, in: store.timeZone) }

    private var hasDetails: Bool {
        due != nil || task.location != nil || task.recurrence != nil || !task.reminders.isEmpty || !task.images.isEmpty
            || progress != nil || parent != nil || showProject || task.memoSource != nil
            || commentBadge != nil
    }

    @ViewBuilder private var details: some View {
        if hasDetails {
            HStack(spacing: 10) {
                if let event = task.event, !done {
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
                        .foregroundStyle(.toneRepeat)
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
                if !task.images.isEmpty {
                    Detail(systemImage: "photo", text: "\(task.images.count)")
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel(task.images.count == 1 ? "1 image" : "\(task.images.count) images")
                }
                if let commentBadge {
                    CommentBadgeView(badge: commentBadge)
                }
                if task.memoSource != nil {
                    Image(systemName: "waveform")
                        .imageScale(.small)
                        .accessibilityLabel("From Notouroboros")
                }
                if let parent {
                    Detail(systemImage: "arrow.turn.down.right", text: parent.title)
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel("Subtask of \(parent.title)")
                }
                if showProject {
                    Spacer(minLength: 0)
                    Detail(systemImage: project == nil ? "tray" : "number", text: store.placeName(task.projectId, task.sectionId))
                }
            }
            .font(.caption)
            .foregroundStyle(.muted)
            .lineLimit(1)
        }
    }
}

private extension View {
    /// Outside a `List`, an edge whose builder is empty still swipes open, to nothing, and the next swipe the other way
    /// only closes it. So an edge with no button is left off.
    @ViewBuilder func swipeActions(edge: HorizontalEdge, when present: Bool, @ViewBuilder content: () -> some View) -> some View {
        if present { swipeActions(edge: edge, allowsFullSwipe: true, content: content) } else { self }
    }
}

extension TaskRow where Trailing == EmptyView {
    init(task: TaskItem, showProject: Bool = false, timeOnly: Bool = false, added: String? = nil) {
        self.init(task: task, showProject: showProject, timeOnly: timeOnly, added: added) { EmptyView() }
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

/// The comment count in gray, or the unread count in the accent color with a filled bubble while some are unread.
private struct CommentBadgeView: View {
    let badge: CommentBadge

    var body: some View {
        let unread = badge.unread > 0
        HStack(spacing: 3) {
            Image(systemName: unread ? "bubble.left.fill" : "bubble.left").imageScale(.small)
            Text("\(unread ? badge.unread : badge.count)").monospacedDigit()
        }
        .foregroundStyle(unread ? Color.accent : Color.muted)
        .fontWeight(unread ? .semibold : .regular)
        .contentTransition(.numericText())
        .animation(.snappy, value: badge)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(unread ? "\(badge.unread) unread of \(badge.count) comments" : "\(badge.count) comments")
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
