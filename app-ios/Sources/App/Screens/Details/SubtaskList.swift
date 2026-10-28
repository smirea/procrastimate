import Core
import SwiftUI

/// A task's subtasks in its details, as list rows placed as subtasks, each dragging into order by its handle.
/// `Add subtask` parses like quick add, without `#` projects, unless its own plain text toggle is on, and keeps focus
/// for the next one with the toggle off again.
struct SubtaskList: View {
    @Environment(Store.self) private var store
    @Environment(\.clock) private var clock
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.space) private var taskSpace

    let task: TaskItem
    let navigation: DetailsNavigation

    @State private var draft = ""
    @State private var literal = false
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
        let children = store.children(of: task.id)
        let progress = Subtasks.progressOf(children)
        let parsed = QuickAdd.parseSubtask(draft, now: clock.now, labels: store.labels(in: taskSpace), literal: literal, in: clock.timeZone)
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text("Subtasks")
                    .font(.caption.weight(.semibold))
                    .textCase(.uppercase)
                    .foregroundStyle(.muted)
                    .accessibilityAddTraits(.isHeader)
                Spacer()
                if let progress { SubtaskProgress(progress: progress).font(.caption) }
                if !children.isEmpty, taskSpace == .own { ExplodeMenu(task: task) }
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

            if !store.isReadOnly(task.id) {
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
                        suggestNames: !literal,
                        focused: $adding,
                        onSubmit: { add() }
                    )
                    .font(.subheadline)
                    SubtaskPlainTextToggle(on: literal) { literal.toggle() }
                }
                .padding(.horizontal, 4)
            }
        }
        .sensoryFeedback(.success, trigger: progress?.done ?? 0) { old, new in new > old }
        .sensoryFeedback(.impact(weight: .light), trigger: drag?.id)
    }

    nonisolated private static let space = "subtasks"

    private func add() {
        let parsed = QuickAdd.parseSubtask(draft, now: clock.now, labels: store.labels(in: taskSpace), literal: literal, in: clock.timeZone)
        guard let subtask = NewTask(subtask: parsed) else { return }
        withAnimation(reduceMotion ? nil : .snappy) {
            _ = store.addTask(subtask, parentId: task.id)
        }
        draft = ""
        literal = false
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

/// The same row as a list's, placed as a subtask, with the reorder handle at its end.
private struct SubtaskRow<Reorder: Gesture>: View {
    @Environment(Store.self) private var store

    let child: TaskItem
    let reorderable: Bool
    let lifted: Bool
    let open: () -> Void
    let move: (Int) -> Void
    let dragGesture: Reorder

    var body: some View {
        TaskRow(task: child, placement: .subtask(open: open)) {
            if reorderable && !store.isReadOnly(child.id) {
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
}

extension NewTask {
    init?(subtask parsed: QuickAdd.Parsed) {
        guard !parsed.title.isEmpty else { return nil }
        self.init(
            title: parsed.title,
            labelIds: parsed.labelIds,
            due: parsed.due,
            recurrence: parsed.recurrence,
            priority: parsed.priority,
            reminders: parsed.reminders
        )
    }
}

/// Turns the subtasks into tasks of their own. The parent stays, and the toast undoes it.
private struct ExplodeMenu: View {
    @Environment(TaskActions.self) private var actions
    let task: TaskItem

    var body: some View {
        Menu {
            Section("Turn into tasks") {
                Button("Keep titles", systemImage: "arrow.up.right") { actions.explode(task, .direct) }
                Button("Start with “\(task.title):”", systemImage: "text.insert") { actions.explode(task, .prefix) }
                Button("Inherit labels, date, and priority", systemImage: "tag") { actions.explode(task, .inherit) }
            }
        } label: {
            Image(systemName: "ellipsis")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.muted)
                .frame(width: 44, height: 32)
                .contentShape(.rect)
        }
        .accessibilityLabel("Subtask actions")
    }
}
