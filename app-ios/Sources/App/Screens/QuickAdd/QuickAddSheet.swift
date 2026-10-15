import Core
import SwiftUI
import UIKit

/// Quick add: a glass card attached to the top of the keyboard with the smart input, the chips that spell out what
/// the text set, and the project picker. It is an overlay rather than a sheet, because a sheet floats above the
/// keyboard with a gap. Saving closes it and shows the new task in its list; dismissing discards the draft.
struct QuickAddSheet: View {
    @Environment(\.clock) private var clock
    let defaults: QuickAddDefaults

    var body: some View {
        QuickAddForm(defaults: defaults, today: clock.today)
    }
}

private struct QuickAddForm: View {
    @Environment(Store.self) private var store
    @Environment(Navigator.self) private var navigator
    @Environment(\.clock) private var clock
    @Environment(\.space) private var space

    /// Quick add from a shared project or label names only that space's projects and labels.
    private var spaceProjects: [Project] { store.projects(in: space) }
    private var spaceLabels: [Core.Label] { store.labels(in: space) }

    @State private var draft: QuickAddDraft
    @State private var listAt: Int?
    /// Picked with their chips only; neither has a phrase in the text.
    @State private var location: TaskLocation?
    @State private var event: TaskEvent?
    @State private var subtasks: [DraftSubtask] = []
    @State private var subtaskText = ""
    @State private var subtasksOpen = false
    @FocusState private var focused: Bool
    @FocusState private var subtaskFocused: Bool

    init(defaults: QuickAddDefaults, today: DateKey) {
        _draft = State(initialValue: QuickAddDraft(defaults: defaults, today: today))
    }

    private var showMic: Bool { draft.text.isEmpty }

    var body: some View {
        let parsed = draft.parse(now: clock.now, projects: spaceProjects, labels: spaceLabels, in: clock.timeZone)
        let resolved = draft.resolved(parsed)
        VStack(alignment: .leading, spacing: 12) {
            SmartInput(
                text: Binding(get: { draft.text }, set: { draft.setText($0) }),
                tokens: parsed.tokens,
                label: "Task name",
                placeholder: "Call mom tomorrow 5pm p1 remind me 30m before",
                listAt: $listAt,
                focused: $focused,
                onSubmit: { submit() }
            )
            .font(.body.weight(.medium))
            .padding(.trailing, showMic ? 36 : 0)
            .overlay(alignment: .trailing) {
                if showMic { micButton.transition(.scale(scale: 0.6).combined(with: .opacity)) }
            }
            .animation(.snappy(duration: 0.16), value: showMic)
            if subtasksOpen || !subtasks.isEmpty {
                QuickAddSubtasks(spaceLabels: spaceLabels, subtasks: $subtasks, text: $subtaskText, focused: $subtaskFocused) { submit() }
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
            HStack(alignment: .top, spacing: 6) {
                FlowLayout(spacing: 6) {
                    chips(parsed, resolved)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                subtaskChip
                PriorityChip(priority: resolved.priority, iconOnly: true) { priority in
                    draft.clearToken(.priority, in: parsed)
                    draft.picked.priority = priority
                }
            }
            .animation(.snappy(duration: 0.16), value: parsed.tokens)

            HStack(spacing: 8) {
                ProjectChip(projectId: resolved.projectId) { id in
                    draft.clearToken(.project, in: parsed)
                    draft.picked.projectId = id
                }
                Spacer(minLength: 0)
                Button("Cancel") { navigator.sheet = nil }
                    .buttonStyle(.plain)
                    .foregroundStyle(.muted)
                    .padding(.horizontal, 12)
                    .frame(minHeight: 44)
                Button("Add task") { submit() }
                    .buttonStyle(.borderedProminent)
                    .buttonBorderShape(.capsule)
                    .disabled(parsed.title.isEmpty)
            }
        }
        .animation(.snappy(duration: 0.2), value: subtasksOpen)
        .padding(.horizontal, 16)
        .padding(.top, 20)
        .padding(.bottom, 8)
        .frame(maxWidth: .infinity)
        .background {
            // Runs under the home indicator when the keyboard is down, and meets the keyboard's top edge when it is up.
            Color.clear
                .glassEffect(.regular, in: UnevenRoundedRectangle(topLeadingRadius: 32, topTrailingRadius: 32, style: .continuous))
                .ignoresSafeArea(.container, edges: .bottom)
        }
        // A tap between controls, or just beside the plain mic glyph, would otherwise reach the scrim and close the card.
        .contentShape(.rect)
        .sensoryFeedback(.selection, trigger: draft.picked)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("Quick add")
        .onAppear { focused = true }
        .onChange(of: subtaskFocused) {
            if !subtaskFocused, subtaskText.isEmpty, subtasks.isEmpty { subtasksOpen = false }
        }
    }

    private var subtaskChip: some View {
        Button {
            subtasksOpen = true
            subtaskFocused = true
        } label: {
            Chip(
                systemImage: "checklist",
                text: subtasks.isEmpty ? "" : "\(subtasks.count)",
                tone: subtasksOpen || !subtasks.isEmpty ? .ink : .muted
            )
            .contentShape(.rect.inset(by: -6))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(subtasks.isEmpty ? "Add subtask" : "Add subtask, \(subtasks.count) added")
    }

    private var micButton: some View {
        Button {
            navigator.sheet = .ramble(draft.defaults)
        } label: {
            Image(systemName: "mic.fill")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.white)
                .frame(width: 32, height: 32)
                .glassEffect(.regular.tint(.accent).interactive(), in: .circle)
                .frame(width: 44, height: 44)
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Ramble")
    }

    @ViewBuilder
    private func chips(
        _ parsed: QuickAdd.Parsed,
        _ resolved: (due: Due?, priority: Priority, projectId: String?, labelIds: [String])
    ) -> some View {
        let today = clock.today
        // An event stands in for the date and the repeat, as in task details.
        if event == nil {
            DueChip(due: resolved.due) { due in
                draft.clearToken(.due, in: parsed)
                draft.picked.due = due
            }
        }
        LocationChip(location: location) { location = $0 }
        EventChip(event: event) { event = $0 }
        if event == nil, let recurrence = parsed.recurrence {
            Chip(systemImage: "repeat", text: Format.formatRecurrence(recurrence, resolved.due), tone: .toneRepeat)
        }
        ForEach(Array(draft.picked.reminders.enumerated()), id: \.offset) { item in
            Chip(systemImage: "bell.fill", text: Format.formatReminder(item.element, today), tone: .toneWeek)
        }
        let reminders = zip(parsed.tokens.filter { $0.kind == .reminder }, parsed.reminders).map(ParsedReminder.init)
        ForEach(reminders, id: \.self) { item in
            Chip(systemImage: "bell.fill", text: Format.formatReminder(item.reminder, today), tone: .toneWeek)
        }
        ForEach(spaceLabels.filter { draft.picked.labelIds.contains($0.id) && !parsed.labelIds.contains($0.id) }) {
            Chip(systemImage: "tag.fill", text: $0.name, tone: .ink, iconTone: .toneLabel)
        }
        ForEach(parsed.tokens.filter { $0.kind == .label }, id: \.self) { token in
            Chip(systemImage: "tag.fill", text: QuickAddDraft.labelName(token, spaceLabels) ?? "", tone: .ink, iconTone: .toneLabel)
        }
        // The name the suggestion list is open on already offers to create it there.
        ForEach(NameSearch.unknownNames(draft.text, parsed.tokens, spaceProjects, spaceLabels).filter { $0.start != listAt && space == .own }, id: \.self) { name in
            let title = "Create \(name.sigil.rawValue)\(name.name)"
            Button { create(name) } label: {
                Chip(systemImage: "plus", text: title, tone: .accent)
                    .frame(minHeight: 44)
                    .contentShape(.rect)
            }
                .buttonStyle(.plain)
                .accessibilityLabel(title)
        }
    }

    /// Creates a typed name only when its chip is tapped, so the parser then reads it like any other.
    private func create(_ name: NameSearch.UnknownName) {
        switch name.sigil {
        case .project: _ = store.addProject(name.name)
        case .label: _ = store.addLabel(name.name)
        }
        focused = true
    }

    private func submit() {
        let parsed = draft.parse(now: clock.now, projects: spaceProjects, labels: spaceLabels, in: clock.timeZone)
        guard let task = draft.resolve(parsed) else { return }
        let typing = NewTask(subtask: QuickAdd.parseSubtask(subtaskText, now: clock.now, labels: spaceLabels, in: clock.timeZone))
        let children = subtasks.map(\.task) + (typing.map { [$0] } ?? [])
        let added: TaskItem? = withAnimation(.snappy) {
            guard let added = store.addTask(task) else { return nil }
            for child in children { _ = store.addTask(child, parentId: added.id) }
            if let event {
                store.updateTask(added.id, TaskPatch(due: .some(nil), recurrence: .some(nil), location: .some(location), event: .some(event)))
            } else if let location {
                store.updateTask(added.id, TaskPatch(location: .some(location)))
            }
            return added
        }
        guard let added else { return }
        close(revealing: added.id)
    }

    private func close(revealing taskID: String) {
        navigator.sheet = nil
        if let task = store.task(taskID) { navigator.reveal(task, today: clock.today, in: clock.timeZone) }
    }
}

private struct ParsedReminder: Hashable {
    let token: QuickAdd.Token
    let reminder: Reminder
}

/// A capsule with a quiet fill, since quick add is already glass.
struct Chip: View {
    let systemImage: String
    let text: String
    var tone: Color = .muted
    var iconTone: Color?
    /// Tints the capsule, as a set priority does.
    var fill: Color?

    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: systemImage).imageScale(.small).foregroundStyle(iconTone ?? tone)
            if !text.isEmpty { Text(text).lineLimit(1) }
        }
        .font(.subheadline.weight(.medium))
        .foregroundStyle(tone)
        .padding(.horizontal, 10)
        .frame(minHeight: 32)
        .background(fill.map { $0.opacity(0.18) } ?? Color.ink.opacity(0.06), in: .capsule)
        .contentShape(.capsule)
        .transition(.scale(scale: 0.9).combined(with: .opacity))
    }
}

struct PriorityChip: View {
    let priority: Priority
    var iconOnly = false
    let onChange: @MainActor (Priority) -> Void

    var body: some View {
        Menu {
            Picker("Priority", selection: Binding(get: { priority }, set: onChange)) {
                ForEach(Priority.allCases, id: \.self) { level in
                    SwiftUI.Label { Text(Format.priorityLabel(level)) } icon: { level.flag }.tag(level)
                }
            }
            .pickerStyle(.inline)
        } label: {
            Chip(
                systemImage: priority == .p4 ? "flag" : "flag.fill",
                text: iconOnly ? "" : priority == .p4 ? "Priority" : "P\(priority.rawValue)",
                tone: priority == .p4 ? .muted : .ink,
                iconTone: priority == .p4 ? nil : priority.tone,
                fill: iconOnly && priority != .p4 ? priority.tone : nil
            )
        }
        .menuOrder(.fixed)
        .accessibilityLabel(Format.priorityLabel(priority))
    }
}

struct ProjectChip: View {
    @Environment(Store.self) private var store
    @Environment(\.space) private var space
    let projectId: String?
    let onChange: @MainActor (String?) -> Void

    @State private var creating = false

    var body: some View {
        let project = store.project(projectId)
        Menu {
            Picker("Project", selection: Binding(get: { project?.id }, set: onChange)) {
                SwiftUI.Label("Inbox", systemImage: "tray").tag(String?.none)
                ForEach(store.projects(in: space)) { project in
                    SwiftUI.Label(project.name, systemImage: "number").tag(String?.some(project.id))
                }
            }
            .pickerStyle(.inline)
            if space == .own { Button("New project…", systemImage: "plus") { creating = true } }
        } label: {
            Chip(systemImage: project == nil ? "tray" : "number", text: project?.name ?? "Inbox", tone: project == nil ? .muted : .ink)
        }
        .accessibilityLabel("Project \(project?.name ?? "Inbox")")
        .newProjectPrompt(isPresented: $creating) { onChange($0) }
    }
}

struct FlowLayout: Layout {
    var spacing: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(proposal.width ?? .infinity, subviews)
        return CGSize(width: proposal.width ?? rows.width, height: rows.height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let rows = arrange(bounds.width, subviews)
        for (index, origin) in rows.origins.enumerated() {
            subviews[index].place(at: CGPoint(x: bounds.minX + origin.x, y: bounds.minY + origin.y), proposal: .unspecified)
        }
    }

    private func arrange(_ width: CGFloat, _ subviews: Subviews) -> (origins: [CGPoint], width: CGFloat, height: CGFloat) {
        var origins: [CGPoint] = []
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0, widest: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > 0, x + size.width > width {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            origins.append(CGPoint(x: x, y: y))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
            widest = max(widest, x - spacing)
        }
        return (origins, widest, y + rowHeight)
    }
}

extension Priority {
    /// Menus draw SF Symbols as templates in the app's tint, so the flag is pre-colored to keep each level's color.
    var flag: Image {
        let symbol = UIImage(systemName: self == .p4 ? "flag" : "flag.fill")!
        return Image(uiImage: symbol.withTintColor(UIColor(tone), renderingMode: .alwaysOriginal))
    }
}
