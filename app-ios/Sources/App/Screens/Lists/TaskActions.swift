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

    func explode(_ task: TaskItem, _ method: ExplodeMethod) {
        let previous = withAnimation(.snappy) { store.explodeSubtasks(task.id, method) }
        guard !previous.isEmpty else { return }
        toasts.show(
            previous.count == 1 ? "Turned 1 subtask into a task" : "Turned \(previous.count) subtasks into tasks",
            action: .init(label: "Undo") { [store] in withAnimation(.snappy) { store.restoreExploded(previous) } }
        )
    }

    func copyAsMarkdown(_ document: Markdown.Document) {
        let context = Markdown.Context(tasks: store.allTasks, projects: store.allProjects, labels: store.allLabels, today: clock.today)
        UIPasteboard.general.string = Markdown.toMarkdown(document, context, in: store.timeZone)
        toasts.show("Copied as Markdown", for: .seconds(2))
    }

    func copyAsMarkdown(_ task: TaskItem) {
        copyAsMarkdown(Markdown.Document(sections: [.init(tasks: [task])]))
    }

    func copyAsMarkdown(project: Project) {
        let tasks = Views.projectTasks(store.data(in: store.space(ofProject: project.id) ?? .own).tasks, project.id, in: store.timeZone)
        copyAsMarkdown(Markdown.Document(title: project.name, projectId: project.id, sections: [.init(tasks: tasks)]))
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
