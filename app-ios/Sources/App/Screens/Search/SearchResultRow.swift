import Core
import SwiftUI

/// One search result. A project or label shows its highlighted name. A task shows its status, highlighted title,
/// notes excerpt, parent, matched label chips, due date or completion day, and project, like the web's result rows.
struct SearchResultRow: View {
    @Environment(Store.self) private var store
    @Environment(TaskActions.self) private var actions
    @Environment(\.clock) private var clock
    @Environment(\.today) private var today

    let row: SearchSections.Row
    let selected: Bool
    let open: () -> Void

    var body: some View {
        Button(action: open) {
            content
                .frame(maxWidth: .infinity, minHeight: 32, alignment: .leading)
                .contentShape(.rect)
        }
        .listRowBackground(selected ? Color.ink.opacity(0.07) : Color.clear)
        .swipeActions(edge: .leading, allowsFullSwipe: true) { taskAction }
        .contextMenu { taskAction }
        .accessibilityLabel(spokenLabel)
        .accessibilityIdentifier(identifier)
        .accessibilityValue(matchReadout)
    }

    /// The row's visible strings in reading order, so VoiceOver and XCUITests read what the row shows.
    private var spokenLabel: String {
        switch row {
        case let .project(hit): return hit.item.name
        case let .label(hit): return hit.item.name
        case let .task(hit):
            let task = hit.task
            var parts = [task.title]
            if let notes = hit.matches[.notes]?.first { parts.append(Search.excerpt(notes).text) }
            if let parent = task.parentId.flatMap(store.task) { parts.append("Subtask of \(parent.title)") }
            parts += (hit.matches[.labels] ?? []).map(\.text)
            if let completedAt = task.completedAt {
                parts.append(Browse.completedLine(completedAt, today: today, in: clock.timeZone))
            } else if let due = task.due {
                parts.append(Format.formatDue(due, today))
            }
            parts.append(store.project(task.projectId)?.name ?? "Inbox")
            return parts.joined(separator: ", ")
        }
    }

    @ViewBuilder private var content: some View {
        switch row {
        case let .project(hit):
            NameResult(systemImage: "number", tone: .muted, name: hit.name)
        case let .label(hit):
            NameResult(systemImage: "tag", tone: .toneLabel, name: hit.name)
        case let .task(hit):
            TaskResult(hit: hit)
        }
    }

    /// Completed results reopen and open ones complete, from a leading swipe or the context menu.
    @ViewBuilder private var taskAction: some View {
        if case let .task(hit) = row {
            taskAction(hit.task)
        }
    }

    @ViewBuilder private func taskAction(_ task: TaskItem) -> some View {
        if task.completedAt == nil {
            Button("Complete", systemImage: "checkmark") { actions.complete(task) }
                .tint(.toneToday)
        } else {
            Button("Reopen", systemImage: "arrow.uturn.backward") {
                withAnimation(.snappy) { store.reopenTask(task.id) }
            }
            .tint(.accent)
        }
    }

    private var identifier: String {
        switch row {
        case let .project(hit): "result-project-\(hit.item.name)"
        case let .label(hit): "result-label-\(hit.item.name)"
        case let .task(hit): "result-\(hit.task.title)"
        }
    }

    private var matchReadout: String {
        let highlights: [Search.Highlight] = switch row {
        case let .project(hit): [hit.name]
        case let .label(hit): [hit.name]
        case let .task(hit): Search.TaskField.allCases.flatMap { hit.matches[$0] ?? [] }
        }
        let matched = highlights.flatMap(\.matched)
        return matched.isEmpty ? "" : "Matches \(matched.joined(separator: ", "))"
    }
}

private struct NameResult: View {
    let systemImage: String
    let tone: Color
    let name: Search.Highlight

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: systemImage)
                .foregroundStyle(tone)
                .frame(width: 20)
            Text(name.attributed)
                .foregroundStyle(.ink)
                .lineLimit(1)
        }
    }
}

private struct TaskResult: View {
    @Environment(Store.self) private var store
    @Environment(\.clock) private var clock
    @Environment(\.today) private var today

    let hit: Search.TaskHit

    var body: some View {
        let task = hit.task
        let done = task.completedAt != nil
        let project = store.project(task.projectId)
        HStack(alignment: .top, spacing: 12) {
            Status(done: done, tone: task.priority.tone)
                .padding(.top, 2)
            VStack(alignment: .leading, spacing: 2) {
                Text((hit.matches[.title]?.first ?? Search.Highlight(text: task.title, ranges: [])).attributed)
                    .foregroundStyle(done ? Color.faint : Color.ink)
                    .strikethrough(done, color: .faint)
                    .lineLimit(1)
                if let notes = hit.matches[.notes]?.first {
                    Text(Search.excerpt(notes).attributed)
                        .font(.footnote)
                        .foregroundStyle(.muted)
                        .lineLimit(1)
                }
                if let parent = task.parentId.flatMap(store.task) {
                    HStack(spacing: 3) {
                        Image(systemName: "arrow.turn.down.right").imageScale(.small)
                        Text(parent.title).lineLimit(1)
                    }
                    .font(.caption)
                    .foregroundStyle(.muted)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("Subtask of \(parent.title)")
                }
                if let labels = hit.matches[.labels] {
                    HStack(spacing: 4) {
                        ForEach(labels, id: \.text) { label in
                            HStack(spacing: 3) {
                                Image(systemName: "tag.fill").imageScale(.small).foregroundStyle(.toneLabel)
                                Text(label.attributed).foregroundStyle(.ink)
                            }
                            .padding(.horizontal, 6)
                            .padding(.vertical, 1)
                            .background(.ink.opacity(0.05), in: .capsule)
                        }
                    }
                    .font(.caption)
                }
                if let completedAt = task.completedAt {
                    Text(Browse.completedLine(completedAt, today: today, in: clock.timeZone))
                        .font(.caption)
                        .foregroundStyle(.muted)
                } else if let due = task.due {
                    HStack(spacing: 3) {
                        Image(systemName: "calendar").imageScale(.small)
                        Text(Format.formatDue(due, today))
                    }
                    .font(.caption)
                    .foregroundStyle(Format.dueTone(due, today).color)
                }
            }
            Spacer(minLength: 8)
            HStack(spacing: 3) {
                Image(systemName: project == nil ? "tray" : "number").imageScale(.small)
                if let project {
                    Text((hit.matches[.project]?.first ?? Search.Highlight(text: project.name, ranges: [])).attributed)
                } else {
                    Text("Inbox")
                }
            }
            .font(.caption)
            .foregroundStyle(.muted)
            .lineLimit(1)
            .frame(maxWidth: 140, alignment: .trailing)
            .padding(.top, 3)
        }
    }
}

/// The result's status dot: a priority-tinted ring, or a faint filled check once completed.
private struct Status: View {
    let done: Bool
    let tone: Color

    var body: some View {
        ZStack {
            Circle().fill(done ? Color.faint : tone.opacity(0.08))
            Circle().strokeBorder(done ? Color.faint : tone, lineWidth: 1.5)
            if done {
                Image(systemName: "checkmark")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(.surface)
            }
        }
        .frame(width: 18, height: 18)
        .accessibilityHidden(true)
    }
}
