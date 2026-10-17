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
            let data = store.data(in: space)
            let groups = Views.projectGroups(data.tasks, data.sections, project.id, in: store.timeZone)
            let sections = groups.dropFirst().compactMap { group in group.section.map { (section: $0, tasks: group.tasks) } }
            let count = groups.reduce(0) { $0 + $1.tasks.count }
            let done = showCompleted
                ? Views.completedTasks(data.tasks.filter { $0.projectId == project.id }, .init(), in: store.timeZone) : []
            // A view-only shared project takes no new tasks, as on the web.
            let canAdd = space == .own || count == 0 || groups.contains { $0.tasks.contains { !store.isReadOnly($0.id) } }
            TaskListScreen(
                title: project.name,
                isEmpty: count == 0 && sections.isEmpty && !showCompleted,
                emptyTitle: "No tasks yet",
                emptyHint: Browse.projectEmptyHint(project.name),
                open: count
            ) {
                ForEach(groups.first?.tasks ?? []) { TaskRow(task: $0) }
                ForEach(Array(sections.enumerated()), id: \.element.section.id) { index, entry in
                    Section {
                        ForEach(entry.tasks) { TaskRow(task: $0) }
                    } header: {
                        SectionHeading(
                            section: entry.section,
                            tasks: entry.tasks,
                            index: index,
                            count: sections.count,
                            editable: space == .own,
                            canAdd: canAdd,
                            removing: StoreRules.sectionTasks(data.tasks, entry.section.id).count
                        )
                    }
                }
                if showCompleted { CompletedSection(tasks: done) }
            }
            .animation(.snappy, value: showCompleted)
            .animation(.snappy, value: sections.map(\.section))
            .environment(\.space, space)
            .nameActions(
                noun: "project",
                name: project.name,
                space: space,
                share: API.ShareTarget(kind: .project, id: project.id),
                deletePrompt: Browse.deleteProjectPrompt(project.name, taskCount: count),
                copy: { actions.copyAsMarkdown(project: project) },
                rename: { store.renameProject(project.id, $0) },
                delete: { store.deleteProject(project.id) },
                addSection: { _ = store.addSection(project.id, $0) }
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

/// A section's heading in its project. A long press opens its menu: add a task to it, copy it, and in the user's own
/// project rename, move, and delete it.
private struct SectionHeading: View {
    @Environment(Store.self) private var store
    @Environment(Navigator.self) private var navigator
    @Environment(TaskActions.self) private var actions
    let section: ProjectSection
    let tasks: [TaskItem]
    let index: Int
    let count: Int
    let editable: Bool
    let canAdd: Bool
    /// How many tasks deleting the section removes, done ones and subtasks included.
    let removing: Int

    @State private var renaming = false
    @State private var draft = ""
    @State private var confirmingDelete = false

    var body: some View {
        // A plain List never shows a header's `.contextMenu`, so a long press opens this menu and a tap does nothing.
        Menu {
            if canAdd {
                Button("Add task", systemImage: "plus") {
                    navigator.sheet = .quickAdd(QuickAddDefaults(projectId: section.projectId, sectionId: section.id))
                }
            }
            Button("Copy as Markdown", systemImage: "doc.on.doc") {
                actions.copyAsMarkdown(
                    Markdown.Document(sections: [.init(heading: section.name, tasks: tasks)])
                )
            }
            if editable {
                Button("Rename", systemImage: "pencil") {
                    draft = section.name
                    renaming = true
                }
                Button("Move up", systemImage: "arrow.up") {
                    withAnimation(.snappy) { store.moveSection(section.id, to: index - 1) }
                }
                .disabled(index == 0)
                Button("Move down", systemImage: "arrow.down") {
                    withAnimation(.snappy) { store.moveSection(section.id, to: index + 1) }
                }
                .disabled(index == count - 1)
                Button("Delete section", systemImage: "trash", role: .destructive) { confirmingDelete = true }
            }
        } label: {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(section.name)
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.ink)
                Spacer(minLength: 0)
                PendingCount(open: tasks.count)
                Image(systemName: "ellipsis")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.faint)
            }
            .textCase(nil)
            .padding(.top, 14)
            .contentShape(.rect)
        } primaryAction: {}
        .buttonStyle(.plain)
        .accessibilityAddTraits(.isHeader)
        .accessibilityIdentifier("heading-\(section.name)")
        .alert("Rename section", isPresented: $renaming) {
            TextField("Section name", text: $draft)
                .submitLabel(.done)
            Button("Cancel", role: .cancel) {}
            Button("Rename") {
                let trimmed = draft.trimmingCharacters(in: .whitespacesAndNewlines)
                if !trimmed.isEmpty { withAnimation(.snappy) { store.renameSection(section.id, trimmed) } }
            }
            .keyboardShortcut(.defaultAction)
        }
        .confirmationDialog(
            Browse.deleteSectionPrompt(section.name, taskCount: removing),
            isPresented: $confirmingDelete,
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) { withAnimation(.snappy) { store.deleteSection(section.id) } }
        }
    }
}
