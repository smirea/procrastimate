import Core
import SwiftUI

struct ProjectScreen: View {
    @Environment(Store.self) private var store
    @Environment(Navigator.self) private var navigator
    @Environment(TaskActions.self) private var actions
    let projectID: String

    @State private var name: String?
    @AppStorage("showCompleted") private var showCompleted = false

    var body: some View {
        if let project = store.project(projectID) {
            let space = store.space(ofProject: project.id) ?? .own
            let all = store.data(in: space).tasks
            let tasks = Views.projectTasks(all, project.id, in: store.timeZone)
            let done = showCompleted
                ? Views.completedTasks(all.filter { $0.projectId == project.id }, .init(), in: store.timeZone) : []
            TaskListScreen(
                title: project.name,
                isEmpty: tasks.isEmpty && !showCompleted,
                emptyTitle: "No tasks yet",
                emptyHint: Browse.projectEmptyHint(project.name)
            ) {
                ForEach(tasks) { TaskRow(task: $0) }
                if showCompleted { CompletedSection(tasks: done) }
            }
            .animation(.snappy, value: showCompleted)
            .environment(\.space, space)
            .nameActions(
                noun: "project",
                name: project.name,
                space: space,
                share: API.ShareTarget(kind: .project, id: project.id),
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
