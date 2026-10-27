import Core
import Observation
import SwiftUI
import UIKit

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
        toasts.show(message, undo: .completion(.init(previous: completion.previous)), in: store)
        return message
    }

    /// Reopening a subtask reopens its completed ancestors too, so undo puts back each one's `completedAt`. Undo writes
    /// back only that, so an edit made in between survives it.
    func reopen(_ task: TaskItem) {
        let reopened = withAnimation(.snappy) { store.reopenTask(task.id) }
        guard !reopened.isEmpty else { return }
        toasts.show(Format.reopenedToast(task.title), undo: .reopen(.init(reopened: reopened)), in: store)
    }

    func delete(_ task: TaskItem) {
        let removed = withAnimation(.snappy) { store.deleteTask(task.id) }
        guard !removed.isEmpty else { return }
        toasts.show("Deleted “\(task.title)”", undo: .delete(.init(deleted: Deleted(tasks: removed))), in: store)
    }

    /// Deleting a project, section, or label offers undo, which brings back its tasks and label assignments as they were.
    func toastDeleted(_ name: String, _ deleted: Deleted?) {
        guard let deleted else { return }
        toasts.show("Deleted “\(name)”", undo: .delete(.init(deleted: deleted)), in: store)
    }

    func explode(_ task: TaskItem, _ method: ExplodeMethod) {
        let previous = withAnimation(.snappy) { store.explodeSubtasks(task.id, method) }
        guard !previous.isEmpty else { return }
        toasts.show(
            previous.count == 1 ? "Turned 1 subtask into a task" : "Turned \(previous.count) subtasks into tasks",
            undo: .explode(.init(previous: previous)),
            in: store
        )
    }

    func copyAsMarkdown(_ document: Markdown.Document) {
        UIPasteboard.general.string = Markdown.toMarkdown(document, store.allTasks)
        toasts.show("Copied as Markdown", for: .seconds(2))
    }

    func copyAsMarkdown(_ task: TaskItem) {
        copyAsMarkdown(Markdown.Document(sections: [.init(tasks: [task])]))
    }

    func copyAsMarkdown(project: Project) {
        let data = store.data(in: store.space(ofProject: project.id) ?? .own)
        let groups = Views.projectGroups(data.tasks, data.sections, project.id, in: store.timeZone)
        copyAsMarkdown(Markdown.projectDocument(project, groups))
    }

    /// Keeps the time of day, and leaves the repeat to count from the new date.
    func postpone(_ task: TaskItem, to date: DateKey) {
        withAnimation(.snappy) { store.updateTask(task.id, TaskPatch(due: .some(Due(date: date, time: task.due?.time)))) }
        toasts.show(
            "Moved “\(task.title)” to \(Format.formatDate(date, clock.today))",
            undo: .postpone(.init(id: task.id, due: task.due)),
            in: store
        )
    }
}
