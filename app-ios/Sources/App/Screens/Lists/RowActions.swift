import Core
import SwiftUI

extension RowActions {
    /// A task left open under a completed parent is done with it, so it offers Reopen.
    @MainActor init(_ task: TaskItem, in store: Store, rolled: Bool = false) {
        var effective = task
        effective.completedAt = store.completedAt(task)
        self.init(effective, readOnly: store.isReadOnly(task.id), rolled: rolled)
    }
}

extension Store {
    /// The postpone options for `task`, whose `Next empty day` skips every day an open task of the user's own sits on.
    @MainActor func postponeOptions(_ task: TaskItem, _ today: DateKey) -> [Format.PostponeOption] {
        Format.postponeOptions(
            Triggers.scheduledDue(task, today, in: timeZone),
            today,
            Triggers.scheduledDays(openTasks, today, in: timeZone)
        )
    }
}

extension RowActions.Toggle {
    var label: String { self == .complete ? "Complete" : "Reopen" }
    var swipeImage: String { self == .complete ? "checkmark" : "arrow.uturn.backward" }
    var menuImage: String { self == .complete ? "checkmark.circle" : "arrow.uturn.backward.circle" }
}

extension View {
    /// A row's actions, from `RowActions`: Complete or Reopen from the leading swipe, Postpone from the trailing one, and
    /// the same in the context menu. Postpone opens quick add's date chooser on the row, with the postpone options as
    /// its presets.
    func taskActions(_ task: TaskItem, _ offered: RowActions, toggle: @escaping () -> Void) -> some View {
        modifier(TaskActionsModifier(task: task, offered: offered, toggle: toggle))
    }
}

private struct TaskActionsModifier: ViewModifier {
    @Environment(Store.self) private var store
    @Environment(TaskActions.self) private var actions
    @Environment(\.today) private var today

    let task: TaskItem
    let offered: RowActions
    let toggle: () -> Void

    /// The date the chooser opened on, which its one toast offers to put back.
    @State private var postponing: Due??

    func body(content: Content) -> some View {
        content
            .swipeActions(edge: .leading, when: offered.toggle != nil) {
                if let action = offered.toggle {
                    Button(action.label, systemImage: action.swipeImage, action: toggle)
                        .tint(action == .complete ? .toneSoon : .accent)
                }
            }
            .swipeActions(edge: .trailing, when: offered.postpone) {
                Button("Postpone", systemImage: "calendar.badge.clock", action: postpone)
                    .tint(.toneWeek)
            }
            .contextMenu { menu }
            .popover(isPresented: Binding(get: { postponing != nil }, set: { if !$0 { finish() } })) {
                DuePopover(
                    due: store.task(task.id)?.due,
                    presets: store.postponeOptions(task, today),
                    closesOnDay: true,
                    onChange: { actions.setDue(task, $0) },
                    close: finish
                )
                .presentationCompactAdaptation(.popover)
            }
            // Outside a `List`, as in task details, swipe actions keep the buttons and closures they were first built
            // with, so the row rebuilds whenever what they offer changes.
            .id(offered)
    }

    @ViewBuilder private var menu: some View {
        if let action = offered.toggle {
            Button(action.label, systemImage: action.menuImage, action: toggle)
        }
        if offered.postpone {
            Button("Postpone", systemImage: "calendar.badge.clock", action: postpone)
        }
        if offered.delete {
            Button("Delete", systemImage: "trash", role: .destructive) { actions.delete(task) }
        }
        Button("Copy as Markdown", systemImage: "doc.on.doc") { actions.copyAsMarkdown(task) }
    }

    private func postpone() {
        postponing = .some(store.task(task.id)?.due)
    }

    private func finish() {
        guard let original = postponing else { return }
        postponing = nil
        actions.toastPostponed(task, from: original)
    }
}

private extension View {
    /// Outside a `List`, an edge whose builder is empty still swipes open, to nothing, and the next swipe the other way
    /// only closes it. So an edge with no button is left off.
    @ViewBuilder func swipeActions(edge: HorizontalEdge, when present: Bool, @ViewBuilder content: () -> some View) -> some View {
        if present { swipeActions(edge: edge, allowsFullSwipe: true, content: content) } else { self }
    }
}
