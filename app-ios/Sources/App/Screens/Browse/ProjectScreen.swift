import Core
import SwiftUI

struct ProjectScreen: View {
    @Environment(Store.self) private var store
    @Environment(Navigator.self) private var navigator
    @Environment(TaskActions.self) private var actions
    let projectID: String

    @State private var name: String?

    var body: some View {
        if let project = store.project(projectID) {
            let tasks = Views.projectTasks(store.tasks, project.id, in: store.timeZone)
            TaskListScreen(
                title: project.name,
                isEmpty: tasks.isEmpty,
                emptyTitle: "No tasks yet",
                emptyHint: Browse.projectEmptyHint(project.name)
            ) {
                ForEach(tasks) { TaskRow(task: $0) }
            }
            .nameActions(
                noun: "project",
                name: project.name,
                deletePrompt: Browse.deleteProjectPrompt(project.name, taskCount: tasks.count),
                copy: { actions.copyAsMarkdown(project: project) },
                rename: { store.renameProject(project.id, $0) },
                delete: { store.deleteProject(project.id) }
            )
            .task(id: project.name) { name = project.name }
        } else {
            // Sync merges a project into the oldest one with its name, so the screen follows the name there.
            Color.clear.task {
                let survivor = name.flatMap { name in store.projects.first { $0.name.lowercased() == name.lowercased() } }
                navigator.replace(.project(id: projectID), with: survivor.map { .project(id: $0.id) })
            }
        }
    }
}
