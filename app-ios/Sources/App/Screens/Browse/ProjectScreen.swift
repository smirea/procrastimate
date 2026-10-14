import Core
import SwiftUI

struct ProjectScreen: View {
    @Environment(Store.self) private var store
    let projectID: String

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
                rename: { store.renameProject(project.id, $0) },
                delete: { store.deleteProject(project.id) }
            )
        } else {
            ContentUnavailableView("This project no longer exists.", systemImage: "number")
        }
    }
}
