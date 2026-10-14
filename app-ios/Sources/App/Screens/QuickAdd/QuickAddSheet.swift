import Core
import SwiftUI
import UIKit

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
    @State private var session = RambleSession()
    @State private var listening = false
    @State private var typed = false
    @State private var notice: String?
    @State private var transcript = ""
    @State private var applyOnStop = true
    /// Picked with their chips only; neither has a phrase in the text.
    @State private var location: TaskLocation?
    @State private var event: TaskEvent?
    /// Text writes that came from the recognizer, so the field's change does not count as typing.
    @State private var speechWrites = 0
    @State private var spoken = Spoken.none
    @State private var liveParse: Task<Void, Never>?
    @FocusState private var focused: Bool

    init(defaults: QuickAddDefaults, today: DateKey) {
        _draft = State(initialValue: QuickAddDraft(defaults: defaults, today: today))
    }

    private var showMic: Bool { listening || !typed }

    var body: some View {
        let parsed = shownParse()
        let resolved = draft.resolved(parsed)
        VStack(alignment: .leading, spacing: 12) {
            if !spoken.isList {
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
                if showMic { micButton }
            }
            }
            if !spoken.tasks.isEmpty {
                SpokenTaskList(spoken: spoken) { removeSpoken($0, $1) }
            }
            if let notice {
                Text(notice).font(.footnote).foregroundStyle(.muted)
            }

            if spoken == .none {
            HStack(alignment: .top, spacing: 6) {
                FlowLayout(spacing: 6) {
                    chips(parsed, resolved)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                PriorityChip(priority: resolved.priority, iconOnly: true) { priority in
                    draft.clearToken(.priority, in: parsed)
                    draft.picked.priority = priority
                }
            }
            .animation(.snappy(duration: 0.16), value: parsed.tokens)
            }

            HStack(spacing: 8) {
                if spoken == .none {
                    ProjectChip(projectId: resolved.projectId) { id in
                        draft.clearToken(.project, in: parsed)
                        draft.picked.projectId = id
                    }
                }
                Spacer(minLength: 0)
                Button("Cancel") { navigator.sheet = nil }
                    .buttonStyle(.plain)
                    .foregroundStyle(.muted)
                    .padding(.horizontal, 12)
                    .frame(minHeight: 44)
                Button(addLabel) { submit() }
                    .buttonStyle(.borderedProminent)
                    .buttonBorderShape(.capsule)
                    .disabled(listening || (spoken.isList ? false : spoken != .none || parsed.title.isEmpty))
            }
        }
        .animation(.snappy(duration: 0.22), value: spoken)
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
        .onChange(of: navigator.startRambleListening, initial: true) {
            guard navigator.startRambleListening else { return }
            navigator.startRambleListening = false
            startRamble()
        }
        .onDisappear { if listening { stopRamble(apply: false) } }
        .onChange(of: draft.text) {
            if speechWrites > 0 {
                speechWrites -= 1
                return
            }
            if listening { stopRamble(apply: false) }
            if case .reviewing = spoken { spoken = .none }
            typed = !draft.text.isEmpty
        }
    }

    private var addLabel: String {
        guard spoken.isList else { return "Add task" }
        let count = spoken.tasks.count
        return count == 1 ? "Add task" : "Add \(count) tasks"
    }

    private var micButton: some View {
        Button {
            if listening { stopRamble(apply: true) } else { startRamble() }
        } label: {
            Image(systemName: listening ? "stop.fill" : "mic.fill")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.white)
                .frame(width: 32, height: 32)
                .glassEffect(.regular.tint(.accent).interactive(), in: .circle)
                .frame(width: 44, height: 44)
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(listening ? "Stop listening" : "Ramble")
    }

    /// While the transcript is streaming, the chips stay put. The grammar fills them when listening stops.
    private func shownParse() -> QuickAdd.Parsed {
        let parsed = draft.parse(now: clock.now, projects: store.projects, labels: store.labels, in: clock.timeZone)
        guard listening else { return parsed }
        return QuickAdd.Parsed(title: draft.text)
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
        if event == nil, let recurrence = parsed.recurrence ?? draft.appliedRecurrence {
            Chip(systemImage: "repeat", text: Format.formatRecurrence(recurrence, resolved.due), tone: .toneRepeat)
        }
        ForEach(Array(draft.picked.reminders.enumerated()), id: \.offset) { item in
            Chip(systemImage: "bell.fill", text: Format.formatReminder(item.element, today), tone: .toneWeek)
        }
        let reminders = zip(parsed.tokens.filter { $0.kind == .reminder }, parsed.reminders).map(ParsedReminder.init)
        ForEach(reminders, id: \.self) { item in
            Chip(systemImage: "bell.fill", text: Format.formatReminder(item.reminder, today), tone: .toneWeek)
        }
        ForEach(store.labels.filter { draft.picked.labelIds.contains($0.id) && !parsed.labelIds.contains($0.id) }) {
            Chip(systemImage: "tag.fill", text: $0.name, tone: .ink, iconTone: .toneLabel)
        }
        ForEach(parsed.tokens.filter { $0.kind == .label }, id: \.self) { token in
            Chip(systemImage: "tag.fill", text: QuickAddDraft.labelName(token, store.labels) ?? "", tone: .ink, iconTone: .toneLabel)
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

    private func submit() {
        guard !listening else { return }
        if spoken.isList {
            saveSpoken(spoken.tasks)
            return
        }
        let parsed = draft.parse(now: clock.now, projects: store.projects, labels: store.labels, in: clock.timeZone)
        guard let task = draft.resolve(parsed) else { return }
        withAnimation(.snappy) {
            let added = store.addTask(task)
            if let event {
                store.updateTask(added.id, TaskPatch(due: .some(nil), recurrence: .some(nil), location: .some(location), event: .some(event)))
            } else if let location {
                store.updateTask(added.id, TaskPatch(location: .some(location)))
            }
        }
        location = nil
        event = nil
        draft.reset(today: clock.today)
        typed = false
        notice = nil
        focused = true
    }

    private func startRamble() {
        notice = nil
        transcript = ""
        spoken = .live([])
        RambleModel.prewarm()
        applyOnStop = true
        listening = true
        typed = false
        let choice = store.dictation
        let deviceId = store.snapshot.sync?.deviceId
        session.onText = { spoken, _ in
            guard listening else { return }
            transcript = spoken
            if spoken != draft.text {
                speechWrites += 1
                draft.setText(spoken)
            }
            parseLive(spoken)
        }
        session.onLevel = { _ in }
        session.onEnd = { end in
            listening = false
            switch end {
            case .stopped:
                if applyOnStop { applyTranscript() }
            case .typed:
                notice = "You can type the task instead."
            case let .failed(message):
                notice = message
                if applyOnStop { applyTranscript() }
            }
        }
        Task { await session.start(choice: choice, deviceId: deviceId) }
    }

    private func stopRamble(apply: Bool) {
        applyOnStop = apply
        listening = false
        liveParse?.cancel()
        if !apply { spoken = .none }
        session.stop()
    }

    /// The grammar runs off the main thread on every transcript update, so a long ramble never stalls the field.
    private func parseLive(_ text: String) {
        liveParse?.cancel()
        let now = clock.now, projects = store.projects, labels = store.labels, zone = clock.timeZone
        liveParse = Task {
            let draft = await Task.detached(priority: .userInitiated) {
                Ramble.parse(text, now: now, projects: projects, labels: labels, in: zone)
            }.value
            guard !Task.isCancelled, listening else { return }
            if draft.ended {
                stopRamble(apply: true)
            } else {
                spoken = .live(draft.tasks)
            }
        }
    }

    private func applyTranscript() {
        let ramble = Ramble.parse(transcript, now: clock.now, projects: store.projects, labels: store.labels, in: clock.timeZone)
        guard !ramble.tasks.isEmpty else {
            spoken = .none
            if !transcript.isEmpty, transcript != draft.text {
                speechWrites += 1
                draft.setText(transcript)
            }
            return
        }
        spoken = .reviewing(ramble.tasks)
        let transcript = transcript
        Task {
            let reviews = await RambleModel.review(transcript, ramble.tasks)
            guard case .reviewing = spoken else { return }
            settle(reviews.map { Ramble.reviewed(ramble.tasks, by: $0, in: transcript) } ?? ramble.tasks)
        }
    }

    /// One plain task goes into the field to edit like typed text; anything more stays as a list to save together.
    private func settle(_ tasks: [RambleTask]) {
        let before = draft.text
        if tasks.count == 1, tasks[0].fitsTheField {
            spoken = .none
            speechWrites += 1
            draft.applyRamble(RambleDraft(tasks: tasks, tokens: [], ended: false), today: clock.today)
        } else {
            spoken = .list(tasks)
            speechWrites += 1
            draft.setText("")
        }
        if draft.text == before { speechWrites -= 1 }
    }

    private func removeSpoken(_ index: Int, _ subtask: Int?) {
        var tasks = spoken.tasks
        guard tasks.indices.contains(index) else { return }
        if let subtask {
            guard tasks[index].subtasks.indices.contains(subtask) else { return }
            tasks[index].subtasks.remove(at: subtask)
        } else {
            tasks.remove(at: index)
        }
        spoken = tasks.isEmpty ? .none : .list(tasks)
    }

    private func saveSpoken(_ tasks: [RambleTask]) {
        let defaults = draft.defaults
        let today = clock.today
        withAnimation(.snappy) {
            for task in tasks {
                let added = store.addTask(Ramble.newTask(task, defaults: defaults, today: today))
                if !task.notes.isEmpty { store.updateTask(added.id, TaskPatch(notes: task.notes)) }
                for subtask in task.subtasks {
                    let child = store.addTask(Ramble.newTask(subtask, defaults: nil, today: today), parentId: added.id)
                    if !subtask.notes.isEmpty { store.updateTask(child.id, TaskPatch(notes: subtask.notes)) }
                }
            }
        }
        spoken = .none
        draft.reset(today: today)
        typed = false
        notice = nil
        focused = true
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

struct DueChip: View {
    @Environment(\.clock) private var clock
    let due: Due?
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
    }
}

struct PriorityChip: View {
    let priority: Priority
    var iconOnly = false
    let onChange: (Priority) -> Void

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
    let projectId: String?
    let onChange: (String?) -> Void

    @State private var creating = false

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
            Button("New project…", systemImage: "plus") { creating = true }
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
