import Core
import SwiftUI

struct SearchResultRow: View {
    @Environment(Store.self) private var store
    @Environment(TaskActions.self) private var actions
    @Environment(\.clock) private var clock
    @Environment(\.today) private var today

    let row: SearchSections.Row
    let selected: Bool
    let open: () -> Void

    var body: some View {
        if case let .task(hit) = row {
            let offered = RowActions(hit.task, in: store)
            let toggle: () -> Void = {
                if offered.toggle == .reopen { actions.reopen(hit.task) } else { actions.complete(hit.task) }
            }
            result
                .taskSwipes(hit.task, offered, toggle: toggle, pickDate: open)
                .contextMenu { TaskMenu(task: hit.task, offered: offered, toggle: toggle) }
        } else {
            result
        }
    }

    private var result: some View {
        // A tap gesture rather than a Button, which would swallow taps on a link in the text.
        content
            .frame(maxWidth: .infinity, minHeight: 32, alignment: .leading)
            .contentShape(.rect)
            .onTapGesture(perform: open)
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isButton)
            .accessibilityAction { open() }
            .listRowBackground(selected ? Color.ink.opacity(0.07) : Color.clear)
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
            NameResult(systemImage: hit.item.systemImage(), tone: hit.item.color.tone, name: hit.name)
        case let .task(hit):
            TaskResult(hit: hit)
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
                TitleFlow(
                    title: Links.attributed(task.title, hit.matches[.title]?.first?.ranges ?? []),
                    labels: (hit.matches[.labels] ?? []).map { match in
                        TitleFlow.Chip(text: match.attributed, color: store.labels.first { $0.name == match.text }?.color ?? .gray)
                    },
                    done: done
                )
                if let notes = hit.matches[.notes]?.first {
                    let excerpt = Search.excerpt(notes)
                    Text(Links.attributed(excerpt.text, excerpt.ranges))
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
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.trailing, 8)
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
            .fixedSize(horizontal: true, vertical: false)
            .padding(.top, 3)
        }
    }
}

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
