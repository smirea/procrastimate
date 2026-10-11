import Core
import Observation
import SwiftUI

/// Completing and deleting from any list, each with an undo toast, plus the success haptic that `RootView` plays.
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

    /// Completes a task, or moves a repeating one to its next occurrence.
    func complete(_ task: TaskItem) {
        guard let completion = withAnimation(.snappy, { store.completeTask(task.id) }) else { return }
        completions += 1
        let store = store
        toasts.show(
            Format.completedToast(task.title, completion.next, clock.today),
            action: .init(label: "Undo") { withAnimation(.snappy) { store.restoreCompletion(completion.previous) } }
        )
    }

    func delete(_ task: TaskItem) {
        let removed = withAnimation(.snappy) { store.deleteTask(task.id) }
        guard !removed.isEmpty else { return }
        let store = store
        toasts.show(
            "Deleted “\(task.title)”",
            action: .init(label: "Undo") { withAnimation(.snappy) { store.undeleteTasks(removed) } }
        )
    }
}
