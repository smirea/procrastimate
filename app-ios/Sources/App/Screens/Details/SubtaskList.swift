import Core
import SwiftUI

/// A task's subtasks in its details: each toggles in place with no toast, opens its own details, and drags into
/// order by its handle. `Add subtask` parses like quick add, without `#` projects, and keeps focus for the next one.
struct SubtaskList: View {
    @Environment(Store.self) private var store
    @Environment(\.clock) private var clock
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    let task: TaskItem
    let navigation: DetailsNavigation

    @State private var draft = ""
    @FocusState private var adding: Bool
    @State private var drag: Drag?
    @State private var frames: [String: CGRect] = [:]

    private struct Drag: Equatable {
        let id: String
        let from: Int
        var to: Int
        var dy: CGFloat
    }

    var body: some View {
        let children = Subtasks.groupChildren(store.tasks)[task.id] ?? []
        let progress = Subtasks.progressOf(children)
        let parsed = QuickAdd.parse(draft, QuickAdd.Options(now: clock.now, labels: store.labels), in: clock.timeZone)
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text("Subtasks")
                    .font(.caption.weight(.semibold))
                    .textCase(.uppercase)
                    .foregroundStyle(.muted)
                    .accessibilityAddTraits(.isHeader)
                Spacer()
                if let progress { SubtaskProgress(progress: progress).font(.caption) }
            }
            .padding(.horizontal, 4)

            VStack(spacing: 0) {
                ForEach(Array(children.enumerated()), id: \.element.id) { index, child in
                    SubtaskRow(
                        child: child,
                        reorderable: children.count > 1,
                        lifted: drag?.id == child.id,
                        open: { navigation.open(child.id) },
                        move: { by in move(child.id, from: index, by: by, count: children.count) },
                        dragGesture: dragGesture(child.id, index, children)
                    )
                    .onGeometryChange(for: CGRect.self) { $0.frame(in: .named(Self.space)) } action: { frames[child.id] = $0 }
                    .offset(y: offset(index, child.id))
                    .zIndex(drag?.id == child.id ? 1 : 0)
                    .animation(drag?.id == child.id || reduceMotion ? nil : .snappy(duration: 0.2), value: drag?.to)
                    .transition(AnyTransition.asymmetric(
                        insertion: AnyTransition.offset(y: -6).combined(with: .opacity),
                        removal: .opacity
                    ))
                }
            }
            .coordinateSpace(.named(Self.space))
            .animation(reduceMotion ? nil : .snappy, value: children.map(\.id))
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Subtasks of \(task.title)")

            HStack(spacing: 10) {
                Image(systemName: "plus")
                    .font(.footnote.weight(.bold))
                    .foregroundStyle(.accent)
                    .frame(width: 22)
                SmartInput(
                    text: $draft,
                    tokens: parsed.tokens,
                    label: "Add subtask",
                    placeholder: "Add subtask",
                    suggestProjects: false,
                    focused: $adding,
                    onSubmit: { add() }
                )
                .font(.subheadline)
            }
            .padding(.horizontal, 4)
        }
        .sensoryFeedback(.success, trigger: progress?.done ?? 0) { old, new in new > old }
        .sensoryFeedback(.impact(weight: .light), trigger: drag?.id)
    }

    nonisolated private static let space = "subtasks"

    private func add() {
        let parsed = QuickAdd.parse(draft, QuickAdd.Options(now: clock.now, labels: store.labels), in: clock.timeZone)
        guard !parsed.title.isEmpty else { return }
        withAnimation(reduceMotion ? nil : .snappy) {
            _ = store.addTask(
                NewTask(
                    title: parsed.title,
                    labelIds: parsed.labelIds,
                    due: parsed.due,
                    recurrence: parsed.recurrence,
                    priority: parsed.priority,
                    reminders: parsed.reminders
                ),
                parentId: task.id
            )
        }
        draft = ""
        adding = true
    }

    private func offset(_ index: Int, _ id: String) -> CGFloat {
        guard let drag else { return 0 }
        if id == drag.id { return drag.dy }
        let step = frames[drag.id]?.height ?? 0
        if drag.from < drag.to, index > drag.from, index <= drag.to { return -step }
        if drag.to < drag.from, index >= drag.to, index < drag.from { return step }
        return 0
    }

    private func dragGesture(_ id: String, _ index: Int, _ children: [TaskItem]) -> some Gesture {
        DragGesture(minimumDistance: 0, coordinateSpace: .named(Self.space))
            .onChanged { value in
                var current = drag ?? Drag(id: id, from: index, to: index, dy: 0)
                current.dy = value.translation.height
                let mids = children.map { frames[$0.id]?.midY ?? 0 }
                let center = mids[current.from] + current.dy
                current.to = mids.indices.filter { $0 != current.from && mids[$0] < center }.count
                drag = current
            }
            .onEnded { _ in
                guard let ended = drag else { return }
                withAnimation(reduceMotion ? nil : .snappy(duration: 0.2)) {
                    if ended.to != ended.from { store.moveSubtask(ended.id, to: ended.to) }
                    drag = nil
                }
            }
    }

    private func move(_ id: String, from index: Int, by: Int, count: Int) {
        let to = index + by
        guard to >= 0, to < count else { return }
        withAnimation(reduceMotion ? nil : .snappy) { store.moveSubtask(id, to: to) }
    }
}

private struct SubtaskRow<Reorder: Gesture>: View {
    @Environment(Store.self) private var store
    @Environment(\.today) private var today

    let child: TaskItem
    let reorderable: Bool
    let lifted: Bool
    let open: () -> Void
    let move: (Int) -> Void
    let dragGesture: Reorder

    var body: some View {
        let done = child.completedAt != nil
        let progress = Subtasks.progressOf(store.tasks.filter { $0.parentId == child.id })
        HStack(spacing: 10) {
            Checkbox(checked: done, tone: child.priority.tone) { toggle(done) }
                .accessibilityLabel("Complete \(child.title)")
                .accessibilityAddTraits(done ? .isSelected : [])
            Button(action: open) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(child.title)
                        .font(.subheadline)
                        .foregroundStyle(done ? Color.faint : Color.ink)
                        .strikethrough(done, color: .faint)
                        .multilineTextAlignment(.leading)
                    if (child.due != nil && !done) || progress != nil {
                        HStack(spacing: 10) {
                            if let due = child.due, !done {
                                HStack(spacing: 3) {
                                    Image(systemName: "calendar").imageScale(.small)
                                    Text(Format.formatDue(due, today))
                                }
                                .foregroundStyle(Format.dueTone(due, today).color)
                            }
                            if let progress { SubtaskProgress(progress: progress) }
                        }
                        .font(.caption)
                    }
                }
                .padding(.vertical, 8)
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("subtask-\(child.title)")
            if reorderable {
                Image(systemName: "line.3.horizontal")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.faint)
                    .frame(width: 44, height: 44)
                    .contentShape(.rect)
                    .gesture(dragGesture)
                    .accessibilityElement()
                    .accessibilityLabel("Reorder \(child.title)")
                    .accessibilityAddTraits(.isButton)
                    .accessibilityAction(named: "Move up") { move(-1) }
                    .accessibilityAction(named: "Move down") { move(1) }
            }
        }
        .padding(.horizontal, 4)
        .background {
            RoundedRectangle(cornerRadius: 16)
                .fill(.background)
                .shadow(color: .black.opacity(0.12), radius: 12, y: 4)
                .opacity(lifted ? 1 : 0)
        }
        .scaleEffect(lifted ? 1.02 : 1)
        .animation(.snappy(duration: 0.16), value: lifted)
    }

    /// The checkbox is its own undo, so there is no toast.
    private func toggle(_ done: Bool) {
        withAnimation(.snappy) {
            if done { store.reopenTask(child.id) } else { _ = store.completeTask(child.id) }
        }
    }
}
