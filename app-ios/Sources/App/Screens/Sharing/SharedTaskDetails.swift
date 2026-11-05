import Core
import Feetback
import SwiftUI

/// What a public link's screen pushes for a tapped task, kept apart from other `String` destinations.
struct SharedTaskID: Hashable {
    let id: String
}

/// A task reached through a public link, read only: what task details show a view-only guest, from the link's own rows.
/// A link carries no comments, activity, images, or places, so those never show, and only the chips that are set do,
/// since an empty chip invites a pick this screen cannot take.
struct SharedTaskDetails: View {
    @Environment(\.today) private var today
    let view: API.SharedView
    let taskID: String

    var body: some View {
        if let task = shared(taskID) {
            content(task)
        } else {
            ContentUnavailableView("This task is not shared", systemImage: "link")
        }
    }

    private func shared(_ id: String?) -> TaskItem? {
        id.flatMap { id in view.tasks.first { $0.id == id } }
    }

    private func content(_ task: TaskItem) -> some View {
        let children = Subtasks.groupChildren(view.tasks)[task.id] ?? []
        let done = { (item: TaskItem) in Triggers.completedAt(of: item, lookup: { shared($0) }) != nil }
        let labels = task.labelIds.compactMap { id in view.labels.first { $0.id == id } }
        return ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack(spacing: 6) {
                    Image(systemName: "person.2")
                    Text("Shared by \(view.owner.name) · View only")
                }
                .font(.footnote.weight(.medium))
                .foregroundStyle(.muted)
                .accessibilityElement(children: .combine)

                if let parent = shared(task.parentId) {
                    NavigationLink(value: SharedTaskID(id: parent.id)) {
                        Chip(systemImage: "arrow.turn.left.up", text: parent.title, tone: .ink)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Parent task \(parent.title)")
                } else {
                    Chip(systemImage: project(of: task)?.systemImage ?? "tray", text: placeName(task), tone: .ink)
                        .accessibilityLabel("Project \(placeName(task))")
                }

                Links.text(task.title, icon: 18)
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(.ink)
                    .textSelection(.enabled)
                    .accessibilityAddTraits(.isHeader)

                chips(task, labels: labels)

                if !task.notes.isEmpty {
                    Links.text(task.notes)
                        .font(.subheadline)
                        .foregroundStyle(.ink)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .background(.ink.opacity(0.04), in: .rect(cornerRadius: 16))
                        .accessibilityLabel("Notes, \(task.notes)")
                }

                if !children.isEmpty {
                    subtasks(children, progress: Subtasks.progressOf(children, parentDone: done(task)), done: done)
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
            .padding(.bottom, 24)
        }
        .background { CanvasBackground() }
        .navigationTitle("Task details")
        .navigationBarTitleDisplayMode(.inline)
        .accessibilityIdentifier("Shared task details")
        .feedback(self)
    }

    @ViewBuilder
    private func chips(_ task: TaskItem, labels: [Core.Label]) -> some View {
        if task.event != nil || task.due != nil || task.priority != .p4 || !task.reminders.isEmpty || !labels.isEmpty {
            FlowLayout(spacing: 6) {
                if let event = task.event {
                    Chip(systemImage: "calendar.badge.clock", text: event.title, tone: .ink)
                } else if let due = task.due {
                    Chip(systemImage: "calendar.circle.fill", text: Format.formatDue(due, today), tone: Format.dueTone(due, today).color)
                    if let recurrence = task.recurrence {
                        Chip(systemImage: "repeat", text: Format.formatRecurrence(recurrence, due), tone: .toneRepeat)
                    }
                }
                if task.priority != .p4 {
                    Chip(systemImage: "flag.fill", text: "P\(task.priority.rawValue)", tone: .ink, iconTone: task.priority.tone)
                        .accessibilityLabel(Format.priorityLabel(task.priority))
                }
                if !task.reminders.isEmpty {
                    Chip(systemImage: "bell.fill", text: "\(task.reminders.count)", tone: .ink, iconTone: .toneWeek)
                        .accessibilityLabel(ReminderMenu.chipLabel(task.reminders.count))
                }
                ForEach(labels) { label in
                    Chip(systemImage: label.systemImage(filled: true), text: label.name, tone: .ink, iconTone: label.color.tone)
                }
            }
        }
    }

    private func subtasks(_ children: [TaskItem], progress: Subtasks.Progress?, done: @escaping (TaskItem) -> Bool) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text("Subtasks")
                    .font(.caption.weight(.semibold))
                    .textCase(.uppercase)
                    .foregroundStyle(.muted)
                    .accessibilityAddTraits(.isHeader)
                Spacer()
                if let progress { SubtaskProgress(progress: progress).font(.caption) }
            }
            .padding(.horizontal, 4)
            ForEach(children) { child in
                let finished = done(child)
                NavigationLink(value: SharedTaskID(id: child.id)) {
                    HStack(spacing: 10) {
                        Image(systemName: finished ? "checkmark.circle.fill" : "circle")
                            .font(.title3)
                            .foregroundStyle(finished ? Color.faint : child.priority.tone)
                            .frame(width: 28, height: 28)
                            .accessibilityHidden(true)
                        Text(child.title)
                            .strikethrough(finished)
                            .foregroundStyle(finished ? .muted : .ink)
                            .lineLimit(2)
                            .multilineTextAlignment(.leading)
                        Spacer(minLength: 0)
                        Image(systemName: "chevron.right")
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(.faint)
                            .accessibilityHidden(true)
                    }
                    .frame(minHeight: 44)
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(finished ? "\(child.title), done" : child.title)
            }
        }
    }

    private func project(of task: TaskItem) -> Project? {
        view.projects.first { $0.id == task.projectId }
    }

    /// `Project / Section`, the project alone, or `Inbox`, as the details' project menu names it.
    private func placeName(_ task: TaskItem) -> String {
        guard let project = project(of: task) else { return "Inbox" }
        guard let section = view.sections.first(where: { $0.id == task.sectionId }) else { return project.name }
        return "\(project.name) / \(section.name)"
    }
}
