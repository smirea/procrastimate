import Core
import SwiftUI

/// What a public share link shows: the shared project, label, or task with its open tasks, read only and without
/// signing in. A member of the space lands on the space's own screen instead, where they can act on it.
struct SharedLinkSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(Store.self) private var store
    @Environment(Navigator.self) private var navigator
    let token: String

    @State private var view: API.SharedView?
    @State private var error: ErrorReport?

    var body: some View {
        NavigationStack {
            Group {
                if let view {
                    SharedList(view: view)
                } else if let error {
                    ContentUnavailableView {
                        SwiftUI.Label("This link does not open", systemImage: "link.badge.plus")
                    } description: {
                        ErrorText(report: error)
                    }
                } else {
                    ProgressView()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background { CanvasBackground() }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(role: .close) { dismiss() }
                        .accessibilityLabel("Close")
                }
            }
        }
        .task { await load() }
    }

    private func load() async {
        do {
            let shared = try await APIClient.send(API.Endpoints.SharedView.self, NoInput(), query: ["token": token], token: nil)
            store.rememberPeople([shared.owner])
            if store.snapshot.spaces[shared.owner.id] != nil || shared.owner.id == Session.userID,
               navigator.openShared(shared.target, in: store) {
                return
            }
            withAnimation(.snappy) { view = shared }
        } catch {
            self.error = ErrorReport("The link was turned off, or it is not a ProcrastiMate link.", error: error)
        }
    }
}

private struct SharedList: View {
    @Environment(Store.self) private var store
    let view: API.SharedView

    var body: some View {
        let tasks = rows
        let pending = pendingTitles(listed: tasks + sectionGroups.flatMap(\.tasks))
        let empty = tasks.isEmpty && sectionGroups.allSatisfy(\.tasks.isEmpty)
        List {
            Section {
                ForEach(tasks) { task in
                    SharedTaskRow(task: task, labels: task.labelIds.compactMap { id in view.labels.first { $0.id == id } }, pending: pending[task.id] ?? [])
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                }
            } header: {
                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(.title2.weight(.bold))
                        .foregroundStyle(.ink)
                    HStack(spacing: 4) {
                        Text("Shared by")
                        PersonName(person: view.owner)
                        Text("· View only")
                    }
                    .font(.subheadline)
                    .foregroundStyle(.muted)
                }
                .textCase(nil)
                .padding(.bottom, 8)
            }
            // A shared project shows under its sections, like the project screen.
            ForEach(sectionGroups, id: \.section.id) { group in
                Section {
                    ForEach(group.tasks) { task in
                        SharedTaskRow(task: task, labels: task.labelIds.compactMap { id in view.labels.first { $0.id == id } }, pending: pending[task.id] ?? [])
                            .listRowBackground(Color.clear)
                            .listRowSeparator(.hidden)
                    }
                } header: {
                    Text(group.section.name)
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(.ink)
                        .textCase(nil)
                        .accessibilityAddTraits(.isHeader)
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .overlay {
            if empty {
                ListEmptyState(title: "Nothing open here", hint: "Everything shared with this link is done.")
            }
        }
    }

    private var title: String {
        switch view.target.kind {
        case .project: view.projects.first { $0.id == view.target.id }?.name ?? "Project"
        case .label: view.labels.first { $0.id == view.target.id }.map { "@\($0.name)" } ?? "Label"
        case .task: view.tasks.first { $0.id == view.target.id }?.title ?? "Task"
        case .space: "\(view.owner.name)’s tasks"
        }
    }

    /// Each task's open subtasks, leaving out any the list already shows as rows of their own, as a task share does.
    private func pendingTitles(listed: [TaskItem]) -> [String: [String]] {
        let shown = Set(listed.map(\.id))
        return Subtasks.groupChildren(view.tasks).mapValues { children in
            children.filter { $0.completedAt == nil && !shown.contains($0.id) }.map(\.title)
        }
    }

    private var projectGroups: [Views.ProjectGroup] {
        view.target.kind == .project ? Views.projectGroups(view.tasks, view.sections, view.target.id, in: store.timeZone) : []
    }

    private var sectionGroups: [(section: ProjectSection, tasks: [TaskItem])] {
        projectGroups.dropFirst().compactMap { group in group.section.map { ($0, group.tasks) } }
    }

    /// The shared task and its open subtasks, the open tasks in no section of a project, or the open tasks a label holds.
    private var rows: [TaskItem] {
        let zone = store.timeZone
        switch view.target.kind {
        case .project: return projectGroups.first?.tasks ?? []
        case .label: return Views.labelTasks(view.tasks, view.target.id, in: zone)
        case .task, .space: return view.tasks.filter { $0.completedAt == nil }
        }
    }
}

private struct SharedTaskRow: View {
    @Environment(\.today) private var today
    let task: TaskItem
    let labels: [Core.Label]
    let pending: [String]

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "circle")
                .font(.title3)
                .foregroundStyle(task.priority.tone)
                .frame(width: 28, height: 28)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(task.title).foregroundStyle(.ink).lineLimit(2)
                if !task.notes.isEmpty {
                    Text(task.notes).font(.footnote).foregroundStyle(.muted).lineLimit(2)
                }
                if !pending.isEmpty {
                    PendingSubtasks(titles: pending)
                }
                if task.due != nil || !labels.isEmpty {
                    HStack(spacing: 10) {
                        if let due = task.due {
                            HStack(spacing: 3) {
                                Image(systemName: "calendar").imageScale(.small)
                                Text(Format.formatDue(due, today))
                            }
                            .foregroundStyle(Format.dueTone(due, today).color)
                        }
                        ForEach(labels) { label in
                            HStack(spacing: 3) {
                                Image(systemName: "tag").imageScale(.small)
                                Text(label.name)
                            }
                            .foregroundStyle(.toneLabel)
                        }
                    }
                    .font(.caption)
                }
            }
            .padding(.vertical, 6)
        }
        .padding(.leading, task.parentId == nil ? 0 : 24)
        .accessibilityElement(children: .combine)
    }
}
