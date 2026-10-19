import Core
import SwiftUI

/// Ramble: a fullscreen drawer that listens, shows the waveform of the real mic level, and lets the spoken tasks,
/// their subtasks, and their fields arrive as they are recognized. After stop the on-device model picks the
/// structure, every task stays editable and removable, and one button saves them all. Nothing saves before that.
struct RambleDrawer: View {
    @Environment(Store.self) private var store
    @Environment(Navigator.self) private var navigator
    @Environment(Toasts.self) private var toasts
    @Environment(\.clock) private var clock
    @Environment(\.space) private var space
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    let defaults: QuickAddDefaults

    @State private var capture = RambleCapture()
    @State private var open: String?
    @State private var saved = 0
    @FocusState private var focusedTitle: String?

    private var spaceProjects: [Project] { store.projects(in: space) }
    private var spaceLabels: [Core.Label] { store.labels(in: space) }
    private var items: [RambleEntry] { capture.items }
    private var saving: [RambleEntry] { capture.saving }
    private var phase: RambleCapture.Phase { capture.phase }

    var body: some View {
        VStack(spacing: 0) {
            header
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 4) {
                        if items.isEmpty, phase == .listening {
                            hints.transition(.opacity)
                        }
                        ForEach(items) { entry in
                            row(entry)
                                .id(entry.id)
                                .transition(arrival)
                        }
                        if let notice = capture.notice {
                            Text(notice)
                                .font(.footnote)
                                .foregroundStyle(.muted)
                                .frame(maxWidth: .infinity)
                                .multilineTextAlignment(.center)
                                .padding(.top, 12)
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.vertical, 12)
                    .frame(maxWidth: 600)
                    .frame(maxWidth: .infinity)
                }
                .scrollDismissesKeyboard(.interactively)
                .defaultScrollAnchor(.top)
                .onChange(of: capture.live.count) {
                    guard let last = capture.live.last else { return }
                    withAnimation(.smooth) { proxy.scrollTo(last.id, anchor: .bottom) }
                }
            }
            footer
        }
        .background {
            Color.glassStrongBg
                .background(.ultraThinMaterial)
                .ignoresSafeArea()
        }
        .animation(reduceMotion ? nil : .spring(duration: 0.42, bounce: 0.18), value: items)
        .animation(.snappy(duration: 0.25), value: phase)
        .animation(.snappy(duration: 0.22), value: open)
        .animation(.snappy(duration: 0.22), value: focusedTitle)
        .sensoryFeedback(.impact(weight: .light, intensity: 0.6), trigger: items.count)
        .sensoryFeedback(.success, trigger: saved)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("Ramble")
        .accessibilityAddTraits(.isModal)
        .onAppear { start() }
        .onDisappear { capture.end() }
    }

    private var header: some View {
        HStack {
            Button { close() } label: {
                Image(systemName: "xmark")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(.ink)
                    .frame(width: 44, height: 44)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Close")
            Spacer()
            status
            Spacer()
            Color.clear.frame(width: 44, height: 44)
        }
        .padding(.horizontal, 8)
    }

    @ViewBuilder
    private var status: some View {
        Group {
            switch phase {
            case .listening:
                HStack(spacing: 8) {
                    PulseDot()
                    Text("Listening")
                    TimelineView(.periodic(from: capture.startedAt, by: 1)) { context in
                        let seconds = max(0, Int(context.date.timeIntervalSince(capture.startedAt)))
                        Text("\(seconds / 60):\(String(format: "%02d", seconds % 60))").foregroundStyle(.faint)
                    }
                }
            case .finishing:
                Text("Catching the last words…")
            case .structuring:
                HStack(spacing: 6) {
                    ProgressView().controlSize(.small)
                    Text("Sorting the ramble")
                }
            case .review:
                Text(summary)
            }
        }
        .font(.footnote.weight(.medium).monospacedDigit())
        .foregroundStyle(.muted)
        .contentTransition(.opacity)
    }

    private var summary: String {
        let tasks = saving.count
        guard tasks > 0 else { return "" }
        let subtasks = saving.reduce(0) { $0 + $1.subtasks.count }
        let head = tasks == 1 ? "1 task" : "\(tasks) tasks"
        guard subtasks > 0 else { return head }
        return head + ", " + (subtasks == 1 ? "1 subtask" : "\(subtasks) subtasks")
    }

    private var hints: some View {
        VStack(spacing: 8) {
            Text("Just talk.")
                .font(.system(size: 26, weight: .semibold))
            Text("Tasks, dates, and lists fall into place as you go.")
                .font(.subheadline)
                .foregroundStyle(.muted)
            VStack(spacing: 10) {
                ForEach(["Call mom tomorrow at 5pm, priority one", "Plan the trip, the steps are book flights and find a hotel", "Pay rent on Friday. Next task, water the plants"], id: \.self) {
                    Text("“\($0)”")
                }
            }
            .font(.footnote)
            .foregroundStyle(.faint)
            .padding(.top, 20)
        }
        .multilineTextAlignment(.center)
        .frame(maxWidth: .infinity)
        .padding(.top, 140)
    }

    private var footer: some View {
        VStack(spacing: 4) {
            if capture.busy, !capture.transcript.isEmpty {
                caption
                    .font(.subheadline)
                    .foregroundStyle(.faint)
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                    .transition(.opacity)
            }
            if focusedTitle == nil {
                RambleWaveform(meter: capture.session.meter, active: phase == .listening)
                    .frame(height: 64)
                    .transition(.opacity)
            }
            HStack(spacing: 12) {
                if phase == .review {
                    Button { start() } label: {
                        Image(systemName: "mic.fill")
                            .font(.title3.weight(.semibold))
                            .foregroundStyle(.accent)
                            .frame(width: 56, height: 56)
                            .background(Color.accent.opacity(0.12), in: .circle)
                            .overlay(Circle().strokeBorder(Color.accent.opacity(0.22)))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(items.isEmpty ? "Talk again" : "Keep talking")
                    .transition(.scale(scale: 0.7).combined(with: .opacity))
                    if saving.isEmpty {
                        Button("Type instead") { navigator.sheet = .quickAdd(defaults) }
                            .font(.body.weight(.medium))
                            .foregroundStyle(.ink)
                            .frame(maxWidth: .infinity, minHeight: 56)
                            .background(Color.ink.opacity(0.07), in: .capsule)
                            .buttonStyle(.plain)
                    } else {
                        Button { save() } label: {
                            Text(saving.count == 1 ? "Add task" : "Add \(saving.count) tasks")
                                .font(.body.weight(.semibold))
                                .frame(maxWidth: .infinity, minHeight: 56)
                                .contentTransition(.numericText())
                        }
                        .buttonStyle(.glassProminent)
                        .buttonBorderShape(.capsule)
                        .transition(.move(edge: .trailing).combined(with: .opacity))
                    }
                } else {
                    Button { capture.stop() } label: {
                        ZStack {
                            if phase == .listening {
                                RoundedRectangle(cornerRadius: 5, style: .continuous).frame(width: 20, height: 20)
                            } else {
                                ProgressView().tint(.onAccent)
                            }
                        }
                        .foregroundStyle(.onAccent)
                        .frame(width: 64, height: 64)
                        .glassEffect(.regular.tint(.accent).interactive(), in: .circle)
                    }
                    .buttonStyle(.plain)
                    .disabled(phase != .listening)
                    .accessibilityLabel("Stop listening")
                    .transition(.scale(scale: 0.7).combined(with: .opacity))
                }
            }
            .frame(height: 80)
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 8)
        .frame(maxWidth: 600)
    }

    private var caption: Text {
        let text = capture.transcript as NSString
        var from = max(0, text.length - 140)
        if from > 0 {
            let space = text.range(of: " ", range: NSRange(location: from, length: text.length - from))
            if space.location != NSNotFound { from = space.location + 1 }
        }
        var out = AttributedString(from > 0 ? "… " : "")
        var cursor = from
        for token in capture.tokens.sorted(by: { $0.start < $1.start }) where token.end > cursor {
            let start = max(token.start, cursor)
            if start > cursor { out += AttributedString(text.substring(with: NSRange(location: cursor, length: start - cursor))) }
            var piece = AttributedString(text.substring(with: NSRange(location: start, length: token.end - start)))
            if let kind = QuickAdd.TokenKind(rawValue: token.kind.rawValue) {
                piece.backgroundColor = kind.tint
                piece.foregroundColor = .ink
            } else {
                piece.inlinePresentationIntent = .emphasized
            }
            out += piece
            cursor = token.end
        }
        if cursor < text.length { out += AttributedString(text.substring(from: cursor)) }
        return Text(out)
    }

    private var arrival: AnyTransition {
        .asymmetric(insertion: .modifier(active: Arrive(progress: 0), identity: Arrive(progress: 1)), removal: .opacity)
    }

    private func editable(_ entry: RambleEntry) -> Bool {
        phase == .review && !capture.live.contains { $0.id == entry.id }
    }

    private func row(_ entry: RambleEntry) -> some View {
        let editable = editable(entry)
        let expanded = editable && open == entry.id
        return VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                Circle()
                    .strokeBorder((entry.task.priority ?? .p4).tone, lineWidth: 1.5)
                    .frame(width: 18, height: 18)
                    .alignmentGuide(.firstTextBaseline) { $0[.bottom] - 3 }
                VStack(alignment: .leading, spacing: 6) {
                    if editable {
                        TextField("Task title", text: binding(entry.id, \.title), axis: .vertical)
                            .font(.body.weight(.semibold))
                            .focused($focusedTitle, equals: entry.id)
                            .submitLabel(.done)
                            .onSubmit { focusedTitle = nil }
                            .accessibilityLabel("Task title")
                            .onChange(of: focusedTitle) { if focusedTitle == entry.id { open = entry.id } }
                    } else {
                        Words(text: entry.task.title)
                            .font(.body.weight(.semibold))
                    }
                    if expanded {
                        editor(entry)
                    } else {
                        chips(entry.task)
                    }
                    if !entry.task.notes.isEmpty {
                        Text(entry.task.notes).font(.footnote).foregroundStyle(.muted).lineLimit(2)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                if editable {
                    removeButton(entry.task.title, size: 13) { remove(entry.id) }
                }
            }
            if !entry.subtasks.isEmpty {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(entry.subtasks) { subtask in
                        subtaskRow(subtask, editable: editable)
                            .transition(arrival)
                    }
                }
                .padding(.leading, 19)
                .overlay(alignment: .leading) {
                    Rectangle().fill(Color.ink.opacity(0.1)).frame(width: 1).padding(.leading, 8)
                }
                .padding(.leading, 0)
            }
        }
        .padding(8)
        .background(expanded ? Color.ink.opacity(0.04) : .clear, in: .rect(cornerRadius: 18, style: .continuous))
        .contentShape(.rect)
        .onTapGesture { if editable { focusedTitle = entry.id } }
    }

    private func subtaskRow(_ subtask: RambleEntry, editable: Bool) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Circle()
                .strokeBorder(Color.ink.opacity(0.3), lineWidth: 1.5)
                .frame(width: 14, height: 14)
                .alignmentGuide(.firstTextBaseline) { $0[.bottom] - 2 }
            VStack(alignment: .leading, spacing: 4) {
                if editable {
                    TextField("Subtask title", text: binding(subtask.id, \.title), axis: .vertical)
                        .font(.subheadline)
                        .submitLabel(.done)
                        .accessibilityLabel("Subtask title")
                } else {
                    Words(text: subtask.task.title).font(.subheadline)
                }
                chips(subtask.task)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if editable {
                removeButton(subtask.task.title, size: 11) { remove(subtask.id) }
            }
        }
        .padding(.leading, 10)
        .padding(.vertical, 4)
    }

    private func removeButton(_ title: String, size: CGFloat, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: "xmark")
                .font(.system(size: size, weight: .semibold))
                .foregroundStyle(.faint)
                .frame(width: 44, height: 44)
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .padding(.vertical, -12)
        .padding(.trailing, -8)
        .accessibilityLabel("Remove \(title)")
    }

    private func editor(_ entry: RambleEntry) -> some View {
        FlowLayout(spacing: 6) {
            DueChip(due: entry.task.due) { due in capture.update(entry.id) { $0.due = due } }
            PriorityChip(priority: entry.task.priority ?? .p4) { priority in capture.update(entry.id) { $0.priority = priority } }
            LabelsChip(labelIds: entry.task.labelIds) { ids in capture.update(entry.id) { $0.labelIds = ids } }
            ProjectChip(projectId: entry.task.projectId, showsSections: false) { id, _ in capture.update(entry.id) { $0.projectId = id } }
            if let recurrence = entry.task.recurrence {
                Button { capture.update(entry.id) { $0.recurrence = nil } } label: {
                    Chip(systemImage: "repeat", text: Format.formatRecurrence(recurrence, entry.task.due), tone: .toneRepeat)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Remove repeat")
            }
            ForEach(Array(entry.task.reminders.enumerated()), id: \.offset) { index, reminder in
                Button { capture.update(entry.id) { $0.reminders.remove(at: index) } } label: {
                    Chip(systemImage: "bell.fill", text: Format.formatReminder(reminder, clock.today), tone: .toneWeek)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Remove reminder")
            }
        }
        .transition(.opacity)
    }

    @ViewBuilder
    private func chips(_ task: RambleTask) -> some View {
        let today = clock.today
        let project = task.projectId.flatMap { id in spaceProjects.first { $0.id == id } }
        let labels = spaceLabels.filter { task.labelIds.contains($0.id) }
        if task.due != nil || task.recurrence != nil || !task.reminders.isEmpty || (task.priority ?? .p4) != .p4 || project != nil || !labels.isEmpty {
            FlowLayout(spacing: 6) {
                if let due = task.due {
                    Token(systemImage: "calendar", text: Format.formatDue(due, today), tone: Format.dueTone(due, today).color)
                        .id("due-\(Format.formatDue(due, today))")
                }
                if let recurrence = task.recurrence {
                    Token(systemImage: "repeat", text: Format.formatRecurrence(recurrence, task.due), tone: .toneRepeat)
                }
                ForEach(Array(task.reminders.enumerated()), id: \.offset) { _, reminder in
                    Token(systemImage: "bell.fill", text: Format.formatReminder(reminder, today), tone: .toneWeek)
                }
                if let priority = task.priority, priority != .p4 {
                    Token(systemImage: "flag.fill", text: "P\(priority.rawValue)", tone: priority.tone).id("priority-\(priority.rawValue)")
                }
                if let project {
                    Token(systemImage: project.systemImage, text: project.name, tone: .ink)
                }
                ForEach(labels) { label in
                    Token(systemImage: label.systemImage(filled: true), text: label.name, tone: .ink, iconTone: label.color.tone)
                }
            }
        }
    }

    private func binding(_ id: String, _ field: WritableKeyPath<RambleTask, String>) -> Binding<String> {
        Binding(
            get: { capture.find(id)?.task[keyPath: field] ?? "" },
            set: { value in capture.update(id) { $0[keyPath: field] = value } }
        )
    }

    private func start() {
        open = nil
        focusedTitle = nil
        let clock = clock, store = store, space = space
        capture.start(choice: store.dictation, deviceId: DeviceDefaults.installID) {
            RambleCapture.Context(now: clock.now, projects: store.projects(in: space), labels: store.labels(in: space), zone: clock.timeZone)
        }
    }

    private func close() {
        capture.end()
        navigator.sheet = nil
    }

    private func remove(_ id: String) {
        capture.remove(id)
        if open == id { open = nil }
    }

    private func save() {
        guard !capture.busy, !saving.isEmpty else { return }
        let today = clock.today
        let added = withAnimation(.snappy) {
            saving.compactMap { entry -> TaskItem? in
                guard let added = store.addTask(Ramble.newTask(entry.task, defaults: defaults, labels: spaceLabels)) else { return nil }
                if !entry.task.notes.isEmpty { store.updateTask(added.id, TaskPatch(notes: entry.task.notes)) }
                for subtask in entry.subtasks where !subtask.task.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    guard let child = store.addTask(Ramble.newTask(subtask.task, defaults: nil, labels: spaceLabels), parentId: added.id) else { continue }
                    if !subtask.task.notes.isEmpty { store.updateTask(child.id, TaskPatch(notes: subtask.task.notes)) }
                }
                return added
            }
        }
        saved += 1
        navigator.sheet = nil
        if let first = added.first { navigator.reveal(first, labels: store.labels, today: today, in: clock.timeZone) }
        if added.count > 1 { toasts.show("Added \(added.count) tasks") }
    }
}

private struct Arrive: ViewModifier {
    let progress: Double

    func body(content: Content) -> some View {
        content
            .opacity(progress)
            .blur(radius: (1 - progress) * 6)
            .offset(y: (1 - progress) * 14)
    }
}

private struct Words: View {
    let text: String

    var body: some View {
        let words = text.split(separator: " ").map(String.init)
        FlowLayout(spacing: 4) {
            ForEach(Array(words.enumerated()), id: \.offset) { _, word in
                Text(word)
                    .transition(.modifier(active: Arrive(progress: 0.2), identity: Arrive(progress: 1)))
            }
        }
        .animation(.easeOut(duration: 0.24), value: words)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(text)
    }
}

private struct Token: View {
    let systemImage: String
    let text: String
    let tone: Color
    var iconTone: Color?

    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: systemImage).imageScale(.small).foregroundStyle(iconTone ?? tone)
            Text(text).lineLimit(1)
        }
        .font(.footnote.weight(.semibold))
        .foregroundStyle(tone)
        .padding(.leading, 8)
        .padding(.trailing, 10)
        .frame(minHeight: 26)
        .background(tone.opacity(0.1), in: .capsule)
        .transition(.scale(scale: 0.5).combined(with: .opacity).animation(.spring(duration: 0.34, bounce: 0.45)))
    }
}

private struct PulseDot: View {
    @State private var dim = false

    var body: some View {
        Circle()
            .fill(Color.accent)
            .frame(width: 8, height: 8)
            .scaleEffect(dim ? 0.7 : 1)
            .opacity(dim ? 0.35 : 1)
            .onAppear {
                withAnimation(.easeInOut(duration: 0.8).repeatForever(autoreverses: true)) { dim = true }
            }
    }
}
