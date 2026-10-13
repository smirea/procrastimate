import Core
import SwiftUI

/// Ramble: a live transcript, one card per spoken task, then save. Tap the mic to toggle, or hold it to talk.
struct RambleSheet: View {
    @Environment(Store.self) private var store
    @Environment(Navigator.self) private var navigator
    @Environment(Toasts.self) private var toasts
    @Environment(\.clock) private var clock

    let defaults: QuickAddDefaults

    @State private var committed = ""
    @State private var partialStart = 0
    @State private var tokens: [RambleToken] = []
    @State private var cards: [RambleCard] = []
    @State private var hidden: Set<Int> = []
    @State private var tasks: [RambleTask] = []
    @State private var listening = false
    @State private var typed = false
    @State private var notice: String?
    @State private var editing: UUID?
    @State private var undo: RambleCard?
    @State private var confirming = false
    @State private var holding = false
    @State private var suppressTap = false
    @State private var session = RambleSession()

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 12) {
                transcript
                if let notice {
                    Text(notice).font(.footnote).foregroundStyle(.muted)
                }
                ScrollView {
                    VStack(alignment: .leading, spacing: 8) {
                        if undo != nil {
                            Button("Undo", action: restore).font(.subheadline.weight(.semibold))
                        }
                        ForEach(cards) { card in
                            cardView(card)
                        }
                    }
                }
                HStack {
                    mic
                    Spacer()
                    Button(countLabel(cards.filter { !$0.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }.count, "Add")) {
                        save()
                    }
                    .buttonStyle(.borderedProminent)
                    .buttonBorderShape(.capsule)
                    .disabled(cards.allSatisfy { $0.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty })
                }
            }
            .padding(16)
            .navigationTitle("Ramble")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    if confirming {
                        Button("Discard", role: .destructive, action: close)
                    } else {
                        Button("Cancel", action: cancel)
                    }
                }
                if confirming {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Keep") { confirming = false }
                    }
                }
            }
        }
        .interactiveDismissDisabled(!cards.isEmpty)
        .onAppear {
            guard navigator.startRambleListening else { return }
            navigator.startRambleListening = false
            start()
        }
        .onDisappear {
            session.stop()
            navigator.rambleHoldStop = nil
        }
    }

    private var transcript: some View {
        Group {
            if typed {
                TextField("Type a ramble", text: $committed, axis: .vertical)
                    .lineLimit(3...6)
                    .onChange(of: committed) { _, _ in
                        partialStart = (committed as NSString).length
                        reparse()
                    }
            } else if committed.isEmpty {
                Text("Hold the mic, or tap it, and talk.")
                    .foregroundStyle(.muted)
            } else {
                Text(styledTranscript)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .font(.body)
        .padding(12)
        .frame(maxWidth: .infinity, minHeight: 64, alignment: .topLeading)
        .background(.ink.opacity(0.05), in: .rect(cornerRadius: 16))
        .accessibilityLabel("Live transcript")
    }

    private var mic: some View {
        Button(action: micTap) {
            Image(systemName: "mic.fill")
                .font(.title2.weight(.semibold))
                .frame(width: 56, height: 56)
                .foregroundStyle(.white)
                .background(.accent, in: .circle)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(listening ? "Stop listening" : (committed.isEmpty ? "Ramble" : "Resume"))
        .accessibilityAddTraits(listening ? .isSelected : [])
        .onLongPressGesture(minimumDuration: 0.22, pressing: { pressing in
            if pressing { return }
            guard holding else { return }
            holding = false
            suppressTap = true
            stop()
        }, perform: {
            holding = true
            if !listening { start() }
        })
    }

    private func cardView(_ card: RambleCard) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top) {
                if editing == card.id {
                    VStack(alignment: .leading, spacing: 6) {
                        TextField("Task", text: titleBinding(card))
                            .font(.body.weight(.medium))
                        TextField("Notes", text: notesBinding(card), axis: .vertical)
                            .font(.subheadline)
                            .foregroundStyle(.muted)
                    }
                } else {
                    Button {
                        editing = card.id
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(card.title).font(.body.weight(.medium)).foregroundStyle(.ink).multilineTextAlignment(.leading)
                            if !card.notes.isEmpty {
                                Text(card.notes).font(.subheadline).foregroundStyle(.muted).lineLimit(1)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Edit task")
                }
                Button {
                    discard(card)
                } label: {
                    Image(systemName: "xmark")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(.muted)
                        .frame(width: 36, height: 36)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Discard task")
            }
            FlowLayout(spacing: 6) {
                if editing == card.id {
                    DueChip(due: card.due, onKeepAsText: nil) { due in update(card.id) { $0.due = due } }
                } else if let due = card.due {
                    Chip(systemImage: "calendar", text: Format.formatDue(due, clock.today), tone: Format.dueTone(due, clock.today).color)
                }
                if let name = card.projectId.flatMap({ store.project($0)?.name }) {
                    Chip(systemImage: "number", text: name)
                }
                ForEach(store.labels(of: labelCarrier(card))) { label in
                    Chip(systemImage: "tag.fill", text: label.name, iconTone: .toneLabel)
                }
                if let recurrence = card.recurrence {
                    Chip(systemImage: "repeat", text: Format.formatRecurrence(recurrence, card.due), tone: .toneTomorrow)
                }
                if let priority = card.priority {
                    Chip(systemImage: "flag.fill", text: Format.priorityLabel(priority), tone: .toneOverdue)
                }
                ForEach(Array(card.reminders.enumerated()), id: \.offset) { _, reminder in
                    Chip(systemImage: "bell.fill", text: Format.formatReminder(reminder, clock.today), tone: .toneWeek)
                }
            }
            if !card.subtasks.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(Array(card.subtasks.enumerated()), id: \.offset) { _, sub in
                        Text(sub.notes.isEmpty ? sub.title : "\(sub.title) — \(sub.notes)")
                            .font(.subheadline)
                    }
                }
                .padding(.leading, 12)
                .overlay(alignment: .leading) { Rectangle().fill(.ink.opacity(0.12)).frame(width: 1) }
            }
        }
        .padding(12)
        .background(.ink.opacity(0.05), in: .rect(cornerRadius: 16))
    }

    private var styledTranscript: AttributedString {
        var text = AttributedString(committed)
        let ns = committed as NSString
        for token in tokens where token.end > token.start && token.end <= ns.length {
            guard let range = Range(NSRange(location: token.start, length: token.end - token.start), in: committed),
                  let attr = Range(range, in: text),
                  let color = tint(token.kind)
            else { continue }
            text[attr].backgroundColor = color
        }
        if partialStart < ns.length,
           let range = Range(NSRange(location: partialStart, length: ns.length - partialStart), in: committed),
           let attr = Range(range, in: text) {
            text[attr].foregroundColor = .secondary
        }
        return text
    }

    private func start() {
        notice = nil
        typed = false
        listening = true
        navigator.rambleHoldStop = { stop() }
        let choice = store.dictation
        let deviceId = store.snapshot.sync?.deviceId
        let prefix = committed.trimmingCharacters(in: .whitespacesAndNewlines)
        session.onText = { text, startAt in
            if prefix.isEmpty {
                committed = text
                partialStart = startAt
            } else {
                let gap = prefix.hasSuffix(" ") ? "" : " "
                committed = prefix + gap + text
                partialStart = (prefix as NSString).length + (gap as NSString).length + startAt
            }
            reparse()
        }
        session.onLevel = { _ in }
        session.onEnd = { end in
            listening = false
            navigator.rambleHoldStop = nil
            switch end {
            case .stopped:
                break
            case .typed:
                typed = true
            case let .failed(message):
                typed = true
                notice = message
            }
        }
        Task { await session.start(choice: choice, deviceId: deviceId) }
    }

    private func stop() {
        session.stop()
        listening = false
        navigator.rambleHoldStop = nil
    }

    private func micTap() {
        if suppressTap {
            suppressTap = false
            return
        }
        if listening { stop() } else { start() }
    }

    private func reparse() {
        let draft = Ramble.parse(committed, now: clock.now, projects: store.projects, labels: store.labels, in: clock.timeZone)
        tokens = draft.tokens
        tasks = draft.tasks
        if draft.ended, listening { stop() }
        cards = reconcile(cards, draft.tasks, hidden, defaults, clock.today)
    }

    private func discard(_ card: RambleCard) {
        hidden.insert(card.anchor)
        cards.removeAll { $0.id == card.id }
        if editing == card.id { editing = nil }
        undo = card
        Task {
            try? await Task.sleep(for: .seconds(4))
            if undo?.id == card.id { undo = nil }
        }
    }

    private func restore() {
        guard let card = undo else { return }
        undo = nil
        hidden.remove(card.anchor)
        cards = reconcile([card] + cards, tasks, hidden, defaults, clock.today)
    }

    private func save() {
        let outlines = cards.filter { !$0.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }.map(outline)
        guard !outlines.isEmpty else { return }
        stop()
        let ids = store.addRamble(outlines)
        navigator.sheet = nil
        toasts.show(countLabel(outlines.count, "Added"), action: .init(label: "Undo") { store.deleteTasks(ids) })
    }

    private func cancel() {
        if cards.isEmpty { close() } else { confirming = true }
    }

    private func close() {
        stop()
        navigator.sheet = nil
    }

    private func update(_ id: UUID, _ change: (inout RambleCard) -> Void) {
        guard let index = cards.firstIndex(where: { $0.id == id }) else { return }
        change(&cards[index])
        cards[index].pinned = true
    }

    private func titleBinding(_ card: RambleCard) -> Binding<String> {
        Binding(get: { cards.first { $0.id == card.id }?.title ?? "" }, set: { value in update(card.id) { $0.title = value } })
    }

    private func notesBinding(_ card: RambleCard) -> Binding<String> {
        Binding(get: { cards.first { $0.id == card.id }?.notes ?? "" }, set: { value in update(card.id) { $0.notes = value } })
    }
}

private struct RambleCard: Identifiable {
    var id = UUID()
    var anchor: Int
    var title: String
    var notes: String
    var due: Due?
    var recurrence: Recurrence?
    var priority: Priority?
    var reminders: [Reminder]
    var projectId: String?
    var labelIds: [String]
    var subtasks: [RambleTask]
    var pinned: Bool
}

private func reconcile(
    _ previous: [RambleCard],
    _ tasks: [RambleTask],
    _ hidden: Set<Int>,
    _ defaults: QuickAddDefaults,
    _ today: DateKey
) -> [RambleCard] {
    let byAnchor = Dictionary(previous.map { ($0.anchor, $0) }, uniquingKeysWith: { _, last in last })
    return tasks.compactMap { task in
        if hidden.contains(task.segment.start) { return nil }
        if let old = byAnchor[task.segment.start], old.pinned { return old }
        var labels = task.labelIds
        if let labelId = defaults.labelId, !labels.contains(labelId) { labels.insert(labelId, at: 0) }
        return RambleCard(
            id: byAnchor[task.segment.start]?.id ?? UUID(),
            anchor: task.segment.start,
            title: task.title,
            notes: task.notes,
            due: task.due ?? (defaults.today ? Due(date: today, time: nil) : nil),
            recurrence: task.recurrence,
            priority: task.priority,
            reminders: task.reminders,
            projectId: task.projectId ?? defaults.projectId,
            labelIds: labels,
            subtasks: task.subtasks,
            pinned: false
        )
    }
}

private func outline(_ card: RambleCard) -> RambleOutline {
    RambleOutline(
        title: card.title,
        notes: card.notes,
        due: card.due,
        recurrence: card.recurrence,
        priority: card.priority,
        reminders: card.reminders,
        projectId: card.projectId,
        labelIds: card.labelIds,
        subtasks: card.subtasks.map(outlineTask)
    )
}

private func outlineTask(_ task: RambleTask) -> RambleOutline {
    RambleOutline(
        title: task.title,
        notes: task.notes,
        due: task.due,
        recurrence: task.recurrence,
        priority: task.priority,
        reminders: task.reminders,
        projectId: nil,
        labelIds: task.labelIds,
        subtasks: task.subtasks.map(outlineTask)
    )
}

private func labelCarrier(_ card: RambleCard) -> TaskItem {
    TaskItem(id: card.id.uuidString, title: card.title, labelIds: card.labelIds, priority: .default, createdAt: 0)
}

private func countLabel(_ count: Int, _ verb: String) -> String {
    "\(verb) \(count) \(count == 1 ? "task" : "tasks")"
}

private func tint(_ kind: String) -> Color? {
    switch kind {
    case "due": .tokenDue
    case "priority": .tokenPriority
    case "reminder": .tokenReminder
    case "project": .tokenProject
    case "recurrence": .tokenRecurrence
    case "label": .tokenLabel
    default: nil
    }
}
