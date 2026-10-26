import Core
import SwiftUI

struct ProjectScreen: View {
    @Environment(Store.self) private var store
    @Environment(Navigator.self) private var navigator
    @Environment(TaskActions.self) private var actions
    let projectID: String

    @AppStorage private var showCompleted: Bool
    @StoredFilter private var filter: ListFilter

    init(projectID: String) {
        self.projectID = projectID
        _showCompleted = .showCompleted(API.ShareTarget(kind: .project, id: projectID))
        _filter = StoredFilter(.project(id: projectID))
    }

    var body: some View {
        if let project = store.project(projectID) {
            let space = store.space(ofProject: project.id) ?? .own
            let data = store.data(in: space)
            let allGroups = Views.projectGroups(data.tasks, data.sections, project.id, in: store.timeZone)
            let shown = { (tasks: [TaskItem]) in ListFilters.filterTasks(tasks, filter, me: store.me) }
            let groups = allGroups.map { Views.ProjectGroup(section: $0.section, tasks: shown($0.tasks)) }
            let total = allGroups.reduce(0) { $0 + $1.tasks.count }
            let sections = groups.dropFirst().compactMap { group in group.section.map { (section: $0, tasks: group.tasks) } }
            let count = groups.reduce(0) { $0 + $1.tasks.count }
            let done = showCompleted ? Views.projectCompleted(data.tasks, data.sections, project.id, in: store.timeZone) : nil
            let doneIn = { (id: String?) in shown(done?.groups.first { $0.section?.id == id }?.tasks ?? []) }
            let gone = shown(done?.gone ?? [])
            let anyDone = done.map { done in !gone.isEmpty || done.groups.contains { !$0.tasks.isEmpty } } ?? false
            let canAdd = store.canAdd(to: .project(id: project.id))
            TaskListScreen(
                title: project.name,
                isEmpty: total == 0 && sections.isEmpty && !showCompleted,
                emptyTitle: "No tasks yet",
                emptyHint: Browse.projectEmptyHint(project.name),
                projectIcon: project.icon,
                open: count,
                header: ListHeaders.listHeader(.project(own: space == .own)),
                actions: ListActions(
                    noun: "project",
                    name: project.name,
                    copy: { actions.copyAsMarkdown(Markdown.projectDocument(project, groups)) },
                    share: API.ShareTarget(kind: .project, id: project.id),
                    showCompleted: $showCompleted,
                    addSection: { _ = store.addSection(project.id, $0) },
                    rename: { store.renameProject(project.id, $0) },
                    icon: Binding(get: { project.icon }, set: { store.setProjectIcon(project.id, $0) }),
                    delete: .init(prompt: Browse.deleteProjectPrompt(project.name, taskCount: total)) { store.deleteProject(project.id) }
                ),
                filter: $filter,
                unfiltered: allGroups.flatMap(\.tasks)
            ) {
                ForEach(groups.first?.tasks ?? []) { TaskRow(task: $0) }
                ForEach(doneIn(nil)) { CompletedRow(task: $0) }
                ForEach(Array(sections.enumerated()), id: \.element.section.id) { index, entry in
                    Section {
                        ForEach(entry.tasks) { TaskRow(task: $0) }
                        ForEach(doneIn(entry.section.id)) { CompletedRow(task: $0) }
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
                if done != nil, !gone.isEmpty || !anyDone { CompletedSection(tasks: gone) }
            }
            .animation(.snappy, value: showCompleted)
            .animation(.snappy, value: sections.map(\.section))
            .animation(.snappy, value: filter)
            .navigationSubtitle(store.owner(of: space).map { "Shared by \($0.name)" } ?? "")
            .environment(\.space, space)
        } else {
            Color.clear.task { navigator.drop(.project(id: projectID)) }
        }
    }
}

/// A section's heading in its project. Its accent `+` adds a task to it. A tap or a long press anywhere else opens its
/// menu, titled with the section's name: add a task to it, copy it, and in the user's own project rename, move, and
/// delete it.
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
        HStack(spacing: 0) {
            menu
            if canAdd {
                GroupAddButton(group: section.name, addTo: .project(id: section.projectId, sectionId: section.id))
            }
        }
        .textCase(nil)
        .padding(.top, 4)
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
            Button("Delete", role: .destructive) {
                actions.toastDeleted(section.name, withAnimation(.snappy) { store.deleteSection(section.id) })
            }
        }
    }

    // A plain List never shows a header's `.contextMenu`, so the title is the menu's label.
    private var menu: some View {
        Menu {
            Section(section.name) {
                if canAdd {
                    Button("Add task", systemImage: "plus") {
                        navigator.sheet = .quickAdd(store.quickAddDefaults(.project(id: section.projectId, sectionId: section.id)))
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
            }
        } label: {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(section.name)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.ink)
                Spacer(minLength: 0)
                PendingCount(open: tasks.count)
            }
            .frame(minHeight: 44)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(.isHeader)
        .accessibilityIdentifier("heading-\(section.name)")
    }
}
