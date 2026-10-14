import Core
import SwiftUI

/// What a ramble has produced so far. Live tasks come from the grammar on every transcript update. After stop the
/// on-device model reviews them, and a result the field cannot hold, several tasks or any subtasks or notes, stays as
/// a list to save together.
enum Spoken: Equatable {
    case none
    case live([RambleTask])
    case reviewing([RambleTask])
    case list([RambleTask])

    var tasks: [RambleTask] {
        switch self {
        case .none: []
        case let .live(tasks), let .reviewing(tasks), let .list(tasks): tasks
        }
    }

    var isList: Bool {
        if case .list = self { true } else { false }
    }
}

extension RambleTask {
    /// One plain task fits the quick add field; anything more needs the list.
    var fitsTheField: Bool { subtasks.isEmpty && notes.isEmpty }
}

/// The spoken tasks with their subtasks and the fields the grammar read. Rows can be removed before saving.
struct SpokenTaskList: View {
    @Environment(Store.self) private var store
    @Environment(\.clock) private var clock
    let spoken: Spoken
    let remove: (_ task: Int, _ subtask: Int?) -> Void

    var body: some View {
        let tasks = spoken.tasks
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                ForEach(Array(tasks.enumerated()), id: \.offset) { index, task in
                    VStack(alignment: .leading, spacing: 6) {
                        row(task, subtask: false) { remove(index, nil) }
                        ForEach(Array(task.subtasks.enumerated()), id: \.offset) { subIndex, subtask in
                            row(subtask, subtask: true) { remove(index, subIndex) }
                                .padding(.leading, 26)
                        }
                    }
                    .transition(.opacity.combined(with: .move(edge: .top)))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .animation(.snappy(duration: 0.22), value: tasks)
        }
        .scrollBounceBehavior(.basedOnSize)
        .defaultScrollAnchor(spoken.isList ? .top : .bottom)
        .frame(maxHeight: 320)
        .fixedSize(horizontal: false, vertical: true)
        .overlay(alignment: .bottomTrailing) {
            if case .reviewing = spoken {
                ProgressView()
                    .controlSize(.small)
                    .padding(6)
                    .accessibilityLabel("Sorting the ramble")
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("Spoken tasks")
    }

    private func row(_ task: RambleTask, subtask: Bool, remove: @escaping () -> Void) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Image(systemName: "circle")
                .font(subtask ? .footnote : .body)
                .foregroundStyle(task.priority.map { $0.tone } ?? .muted)
            VStack(alignment: .leading, spacing: 3) {
                Text(task.title)
                    .font(subtask ? .subheadline : .body.weight(.medium))
                    .fixedSize(horizontal: false, vertical: true)
                let details = details(task)
                if !details.isEmpty {
                    Text(details.joined(separator: "  ·  "))
                        .font(.caption)
                        .foregroundStyle(task.due.map { Format.dueTone($0, clock.today).color } ?? .muted)
                }
                if !task.notes.isEmpty {
                    Text(task.notes).font(.caption).foregroundStyle(.muted).lineLimit(2)
                }
            }
            Spacer(minLength: 0)
            if spoken.isList {
                Button(action: remove) {
                    Image(systemName: "xmark")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.muted)
                        .frame(width: 32, height: 32)
                        .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Remove \(task.title)")
            }
        }
        .accessibilityElement(children: .combine)
    }

    private func details(_ task: RambleTask) -> [String] {
        var parts: [String] = []
        if let due = task.due { parts.append(Format.formatDue(due, clock.today)) }
        if let recurrence = task.recurrence { parts.append(Format.formatRecurrence(recurrence, task.due)) }
        if let priority = task.priority { parts.append("P\(priority.rawValue)") }
        if let project = store.projects.first(where: { $0.id == task.projectId }) { parts.append("#\(project.name)") }
        for label in store.labels where task.labelIds.contains(label.id) { parts.append("@\(label.name)") }
        for reminder in task.reminders { parts.append(Format.formatReminder(reminder, clock.today)) }
        return parts
    }
}
