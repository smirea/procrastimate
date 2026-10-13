import Core
import SwiftUI

/// Quick add: a glass card attached to the top of the keyboard with the smart input, the chips that spell out what
/// the text set, and the project picker. It is an overlay rather than a sheet, because a sheet floats above the
/// keyboard with a gap. Saving keeps it open for the next task; dismissing discards the draft.
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

    @State private var draft: QuickAddDraft
    @State private var listAt: Int?
    @FocusState private var focused: Bool

    init(defaults: QuickAddDefaults, today: DateKey) {
        _draft = State(initialValue: QuickAddDraft(defaults: defaults, today: today))
    }

    var body: some View {
        let parsed = draft.parse(now: clock.now, projects: store.projects, labels: store.labels, in: clock.timeZone)
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

            FlowLayout(spacing: 6) {
                chips(parsed, resolved)
            }
            .animation(.snappy(duration: 0.16), value: parsed.tokens)

            HStack(spacing: 8) {
                ProjectChip(projectId: resolved.projectId, onKeepAsText: keepAsText(parsed, .project)) { id in
                    draft.clearToken(.project, in: parsed)
                    draft.picked.projectId = id
                }
                Spacer(minLength: 0)
                Button {
                    navigator.startRambleListening = true
                    navigator.sheet = .ramble(draft.defaults)
                } label: {
                    Image(systemName: "mic.fill")
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.plain)
                .foregroundStyle(.muted)
                .accessibilityLabel("Ramble")
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
        .sensoryFeedback(.selection, trigger: draft.picked)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("Quick add")
        .onAppear { focused = true }
    }

    @ViewBuilder
    private func chips(
        _ parsed: QuickAdd.Parsed,
        _ resolved: (due: Due?, priority: Priority, projectId: String?, labelIds: [String])
    ) -> some View {
        let today = clock.today
        DueChip(due: resolved.due, onKeepAsText: keepAsText(parsed, .due)) { due in
            draft.clearToken(.due, in: parsed)
            draft.picked.due = due
        }
        PriorityChip(priority: resolved.priority, onKeepAsText: keepAsText(parsed, .priority)) { priority in
            draft.clearToken(.priority, in: parsed)
            draft.picked.priority = priority
        }
        if let recurrence = parsed.recurrence {
            Chip(systemImage: "repeat", text: Format.formatRecurrence(recurrence, resolved.due), tone: .toneTomorrow)
                .keepAsText(keepAsText(parsed, .recurrence))
        }
        let reminders = zip(parsed.tokens.filter { $0.kind == .reminder }, parsed.reminders).map(ParsedReminder.init)
        ForEach(reminders, id: \.self) { item in
            Chip(systemImage: "bell.fill", text: Format.formatReminder(item.reminder, today), tone: .toneWeek)
                .keepAsText { keep(item.token) }
        }
        ForEach(store.labels.filter { draft.picked.labelIds.contains($0.id) && !parsed.labelIds.contains($0.id) }) {
            Chip(systemImage: "tag.fill", text: $0.name, tone: .ink, iconTone: .toneLabel)
        }
        ForEach(parsed.tokens.filter { $0.kind == .label }, id: \.self) { token in
            Chip(systemImage: "tag.fill", text: QuickAddDraft.labelName(token, store.labels) ?? "", tone: .ink, iconTone: .toneLabel)
                .keepAsText { keep(token) }
        }
        // The name the suggestion list is open on already offers to create it there.
        ForEach(NameSearch.unknownNames(draft.text, parsed.tokens, store.projects, store.labels).filter { $0.start != listAt }, id: \.self) { name in
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

    private func keepAsText(_ parsed: QuickAdd.Parsed, _ kind: QuickAdd.TokenKind) -> (() -> Void)? {
        parsed.tokens.first { $0.kind == kind }.map { token in { keep(token) } }
    }

    private func keep(_ token: QuickAdd.Token) {
        draft.keepAsText(token)
        focused = true
    }

    private func submit() {
        let parsed = draft.parse(now: clock.now, projects: store.projects, labels: store.labels, in: clock.timeZone)
        guard let task = draft.resolve(parsed) else { return }
        withAnimation(.snappy) { _ = store.addTask(task) }
        draft.reset(today: clock.today)
        focused = true
    }
}

// MARK: Chips

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

    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: systemImage).imageScale(.small).foregroundStyle(iconTone ?? tone)
            Text(text).lineLimit(1)
        }
        .font(.subheadline.weight(.medium))
        .foregroundStyle(tone)
        .padding(.horizontal, 10)
        .frame(minHeight: 32)
        .background(.ink.opacity(0.06), in: .capsule)
        .contentShape(.capsule)
        .transition(.scale(scale: 0.9).combined(with: .opacity))
    }
}

extension View {
    /// Adds `Keep as text` after a chip whose value came from the text.
    @ViewBuilder
    func keepAsText(_ action: (() -> Void)?) -> some View {
        if let action {
            HStack(spacing: 2) {
                self
                Button(action: action) {
                    Image(systemName: "xmark")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(.muted)
                        .frame(width: 26, height: 26)
                        .background(.ink.opacity(0.05), in: .circle)
                        .frame(width: 36, height: 36)
                        .contentShape(.circle)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Keep as text")
            }
            .transition(.scale(scale: 0.9).combined(with: .opacity))
        } else {
            self
        }
    }
}

struct DueChip: View {
    @Environment(\.clock) private var clock
    let due: Due?
    let onKeepAsText: (() -> Void)?
    let onChange: (Due?) -> Void

    @State private var picking = false
    @State private var pickingTime = false

    var body: some View {
        let today = clock.today
        Menu {
            ForEach(QuickAddDraft.datePresets(today), id: \.label) { preset in
                Button(preset.label) { onChange(Due(date: preset.date, time: due?.time)) }
            }
            if due != nil {
                Button("No date", role: .destructive) { onChange(nil) }
            }
            Divider()
            Button("Pick a date", systemImage: "calendar") { picking = true }
            if let due, due.time != nil {
                Button("Change time", systemImage: "clock") { pickingTime = true }
                Button("No time", systemImage: "clock.badge.xmark") { onChange(Due(date: due.date, time: nil)) }
            } else {
                Button("Add time", systemImage: "clock") { onChange(Due(date: due?.date ?? today, time: "09:00")) }
            }
        } label: {
            Chip(
                systemImage: due == nil ? "calendar" : "calendar.circle.fill",
                text: due.map { Format.formatDue($0, today) } ?? "Date",
                tone: due.map { Format.dueTone($0, today).color } ?? .muted
            )
        }
        .accessibilityLabel(due.map { "Due \(Format.formatDue($0, today))" } ?? "Set due date")
        .popover(isPresented: $picking) {
            DatePicker(
                "Due date",
                selection: Binding(
                    get: { Dates.fromDateKey(due?.date ?? today, in: clock.timeZone) },
                    set: {
                        onChange(Due(date: Dates.toDateKey($0, in: clock.timeZone), time: due?.time))
                        picking = false
                    }
                ),
                displayedComponents: .date
            )
            .datePickerStyle(.graphical)
            .environment(\.timeZone, clock.timeZone)
            .environment(\.calendar, clock.calendar)
            .padding()
            .frame(width: 340)
            .presentationCompactAdaptation(.popover)
        }
        .popover(isPresented: $pickingTime) {
            DatePicker(
                "Due time",
                selection: Binding(
                    get: { Dates.fromDateKey(due?.date ?? today, due?.time, in: clock.timeZone) },
                    set: { date in
                        let parts = clock.calendar.dateComponents([.hour, .minute], from: date)
                        onChange(Due(
                            date: due?.date ?? today,
                            time: Dates.toTimeOfDay(hours: parts.hour ?? 9, minutes: parts.minute ?? 0)
                        ))
                    }
                ),
                displayedComponents: .hourAndMinute
            )
            .datePickerStyle(.wheel)
            .labelsHidden()
            .environment(\.timeZone, clock.timeZone)
            .padding()
            .presentationCompactAdaptation(.popover)
        }
        .keepAsText(onKeepAsText)
    }
}

struct PriorityChip: View {
    let priority: Priority
    let onKeepAsText: (() -> Void)?
    let onChange: (Priority) -> Void

    var body: some View {
        Menu {
            Picker("Priority", selection: Binding(get: { priority }, set: onChange)) {
                ForEach(Priority.allCases, id: \.self) { level in
                    SwiftUI.Label(Format.priorityLabel(level), systemImage: level == .p4 ? "flag" : "flag.fill").tag(level)
                }
            }
            .pickerStyle(.inline)
        } label: {
            Chip(
                systemImage: priority == .p4 ? "flag" : "flag.fill",
                text: priority == .p4 ? "Priority" : "P\(priority.rawValue)",
                tone: priority == .p4 ? .muted : .ink,
                iconTone: priority == .p4 ? nil : priority.tone
            )
        }
        .accessibilityLabel(Format.priorityLabel(priority))
        .keepAsText(onKeepAsText)
    }
}

struct ProjectChip: View {
    @Environment(Store.self) private var store
    let projectId: String?
    let onKeepAsText: (() -> Void)?
    let onChange: (String?) -> Void

    var body: some View {
        let project = store.project(projectId)
        Menu {
            Picker("Project", selection: Binding(get: { project?.id }, set: onChange)) {
                SwiftUI.Label("Inbox", systemImage: "tray").tag(String?.none)
                ForEach(store.projects) { project in
                    SwiftUI.Label(project.name, systemImage: "number").tag(String?.some(project.id))
                }
            }
            .pickerStyle(.inline)
        } label: {
            Chip(systemImage: project == nil ? "tray" : "number", text: project?.name ?? "Inbox", tone: project == nil ? .muted : .ink)
        }
        .accessibilityLabel("Project \(project?.name ?? "Inbox")")
        .keepAsText(onKeepAsText)
    }
}

/// Lays chips out in rows, wrapping like the web's chip row.
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
