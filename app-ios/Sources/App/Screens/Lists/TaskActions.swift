import Core
import Observation
import SwiftUI

@MainActor @Observable
final class TaskActions {
    private(set) var completions = 0

    @ObservationIgnored private let store: Store
    @ObservationIgnored private let toasts: Toasts
    @ObservationIgnored private let clock: AppClock

    init(store: Store, toasts: Toasts, clock: AppClock) {
        self.store = store
        self.toasts = toasts
        self.clock = clock
    }

    @discardableResult
    func complete(_ task: TaskItem) -> String? {
        guard let completion = withAnimation(.snappy, { store.completeTask(task.id) }) else { return nil }
        completions += 1
        let message = Format.completedToast(task.title, completion.next, clock.today)
        toasts.show(
            message,
            action: .init(label: "Undo") { [store] in withAnimation(.snappy) { store.restoreCompletion(completion.previous) } }
        )
        return message
    }

    func delete(_ task: TaskItem) {
        let removed = withAnimation(.snappy) { store.deleteTask(task.id) }
        guard !removed.isEmpty else { return }
        toasts.show(
            "Deleted “\(task.title)”",
            action: .init(label: "Undo") { [store] in withAnimation(.snappy) { store.undeleteTasks(removed) } }
        )
    }

    /// Keeps the time of day, and leaves the repeat to count from the new date.
    func postpone(_ task: TaskItem, to date: DateKey) {
        let previous = task.due
        withAnimation(.snappy) { store.updateTask(task.id, TaskPatch(due: .some(Due(date: date, time: task.due?.time)))) }
        toasts.show(
            "Moved “\(task.title)” to \(Format.formatDate(date, clock.today))",
            action: .init(label: "Undo") { [store] in
                withAnimation(.snappy) { store.updateTask(task.id, TaskPatch(due: .some(previous))) }
            }
        )
    }
}
