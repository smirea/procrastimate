import Core
import SwiftUI

extension RowActions {
    @MainActor init(_ task: TaskItem, in store: Store, rolled: Bool = false) {
        self.init(task, readOnly: store.isReadOnly(task.id), rolled: rolled)
    }
}

extension RowActions.Toggle {
    var label: String { self == .complete ? "Complete" : "Reopen" }
    var swipeImage: String { self == .complete ? "checkmark" : "arrow.uturn.backward" }
    var menuImage: String { self == .complete ? "checkmark.circle" : "arrow.uturn.backward.circle" }
}

/// A row's context menu, from `RowActions`. `toggle` completes or reopens it the way the row animates that.
struct TaskMenu: View {
    @Environment(Store.self) private var store
    @Environment(TaskActions.self) private var actions
    @Environment(\.today) private var today

    let task: TaskItem
    let offered: RowActions
    let toggle: () -> Void

    var body: some View {
        if let action = offered.toggle {
            Button(action.label, systemImage: action.menuImage, action: toggle)
        }
        if offered.postpone {
            Menu("Postpone", systemImage: "calendar.badge.clock") {
                ForEach(Format.postponeOptions(Triggers.scheduledDue(task, today, in: store.timeZone), today), id: \.date) { option in
                    Button(option.label) { actions.postpone(task, to: option.date) }
                }
            }
        }
        if offered.delete {
            Button("Delete", systemImage: "trash", role: .destructive) { actions.delete(task) }
        }
        Button("Copy as Markdown", systemImage: "doc.on.doc") { actions.copyAsMarkdown(task) }
    }
}

extension View {
    /// A row's swipes, from `RowActions`: Complete or Reopen from the leading edge, Postpone from the trailing one.
    /// Postpone's `Pick a date…` calls `pickDate`.
    func taskSwipes(
        _ task: TaskItem,
        _ offered: RowActions,
        toggle: @escaping () -> Void,
        pickDate: @escaping () -> Void
    ) -> some View {
        modifier(TaskSwipes(task: task, offered: offered, toggle: toggle, pickDate: pickDate))
    }
}

private struct TaskSwipes: ViewModifier {
    @Environment(Store.self) private var store
    @Environment(TaskActions.self) private var actions
    @Environment(\.today) private var today

    let task: TaskItem
    let offered: RowActions
    let toggle: () -> Void
    let pickDate: () -> Void

    @State private var postponing = false

    func body(content: Content) -> some View {
        content
            .swipeActions(edge: .leading, when: offered.toggle != nil) {
                if let action = offered.toggle {
                    Button(action.label, systemImage: action.swipeImage, action: toggle)
                        .tint(action == .complete ? .toneSoon : .accent)
                }
            }
            .swipeActions(edge: .trailing, when: offered.postpone) {
                Button("Postpone", systemImage: "calendar.badge.clock") { postponing = true }
                    .tint(.toneWeek)
            }
            .confirmationDialog("Postpone “\(task.title)”", isPresented: $postponing, titleVisibility: .visible) {
                ForEach(Format.postponeOptions(Triggers.scheduledDue(task, today, in: store.timeZone), today), id: \.date) { option in
                    Button("\(option.label) · \(Format.weekdayNames[Dates.weekdayOf(option.date)])") {
                        actions.postpone(task, to: option.date)
                    }
                }
                Button("Pick a date…", action: pickDate)
            }
            // Outside a `List`, as in task details, swipe actions keep the buttons and closures they were first built
            // with, so the row rebuilds whenever what they offer changes.
            .id(offered)
    }
}

private extension View {
    /// Outside a `List`, an edge whose builder is empty still swipes open, to nothing, and the next swipe the other way
    /// only closes it. So an edge with no button is left off.
    @ViewBuilder func swipeActions(edge: HorizontalEdge, when present: Bool, @ViewBuilder content: () -> some View) -> some View {
        if present { swipeActions(edge: edge, allowsFullSwipe: true, content: content) } else { self }
    }
}
