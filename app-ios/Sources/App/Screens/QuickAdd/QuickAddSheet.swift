import Core
import ImageIO
import SwiftUI
import UIKit

/// Quick add: a glass card attached to the top of the keyboard with the smart input, the chips that spell out what
/// the text set, and the project picker. It is an overlay rather than a sheet, because a sheet floats above the
/// keyboard with a gap. Saving keeps it open for the next task; dismissing discards the draft.
struct QuickAddSheet: View {
    @Environment(Store.self) private var store
    @Environment(Navigator.self) private var navigator
    @Environment(\.clock) private var clock
    @Environment(TaskImages.self) private var images
    @Environment(Toasts.self) private var toasts

    /// Quick add names every space's projects and labels a task may land on, and a picked one moves the task there.
    private var spaceProjects: [Project] { store.everySpace.projects }
    private var spaceSections: [ProjectSection] { store.everySpace.sections }
    private var spaceLabels: [Core.Label] { store.everySpace.labels }

    @State private var draft: QuickAddDraft
    @State private var listAt: Int?
    @State private var subtasks: [DraftSubtask] = []
    @State private var subtaskText = ""
    @State private var subtaskLiteral = false
    @State private var subtasksOpen = false
    /// Buttons opened from the `+` menu stay in the row for this draft, so their picker has a chip to hang from.
    @State private var opened: [QuickAddButton] = []
    @State private var openTriggers: [QuickAddButton: Int] = [:]
    @State private var scrollTarget: QuickAddButton?
    @State private var fade = RowFade()
    /// Images wait here until the task exists, then attach through task details' offline upload path.
    @State private var drafted: [DraftImage] = []
    @State private var imageSource: ImageSource?
    /// Images still loading or making their thumbnail. Saving waits for them, so none is lost.
    @State private var loadingImages = 0
    /// Built off the main actor when the card opens or the tasks change, so typing never rebuilds it.
    @State private var suggestionIndex: TaskSuggestions.Index?
    /// Scoring scans the whole index, so it reruns only when its inputs change, not on every frame of a drag.
    @State private var pills: [TaskSuggestions.Pill] = []
    /// How far the grabber's drag has pulled the card up, rubber-banded.
    @State private var lift: CGFloat = 0
    @State private var saves = 0
    @State private var confirmation: Int?
    @FocusState private var focused: Bool
    @FocusState private var subtaskFocused: Bool

    init(defaults: QuickAddDefaults) {
        _draft = State(initialValue: QuickAddDraft(defaults: defaults))
    }

    private var showMic: Bool { draft.text.isEmpty }
    private var context: QuickAddDraft.Context {
        QuickAddDraft.Context(now: clock.now, projects: spaceProjects, sections: spaceSections, labels: spaceLabels, zone: clock.timeZone)
    }

    var body: some View {
        let parsed = draft.parse(context)
        let resolved = draft.resolved(parsed)
        VStack(alignment: .leading, spacing: 12) {
            SmartInput(
                text: Binding(get: { draft.text }, set: { draft.setText($0) }),
                tokens: parsed.tokens,
                label: "Task name",
                placeholder: "Call mom tomorrow 5pm p1 remind me 30m before",
                suggestNames: !draft.literal,
                projectId: resolved.projectId,
                listAt: $listAt,
                // Ten lines, so a long dictated title stays readable. With the subtask list open the card has to fit it
                // above the keyboard too, so the title goes back to four lines and the subtask field stays at three.
                maxHeight: subtasksOpen || !subtasks.isEmpty ? 104 : 240,
                focused: $focused,
                onPasteImages: { addImages($0) },
                onSubmit: { submit() }
            )
            .font(.body.weight(.medium))
            .padding(.trailing, showMic ? QuickAddMetrics.cornerButton + 4 : 0)
            .overlay(alignment: .trailing) {
                if showMic { micButton.transition(.scale(scale: 0.6).combined(with: .opacity)) }
            }
            .animation(.snappy(duration: 0.16), value: showMic)
            if !drafted.isEmpty || loadingImages > 0 {
                draftedImages.transition(.opacity.combined(with: .move(edge: .top)))
            }
            if subtasksOpen || !subtasks.isEmpty {
                QuickAddSubtasks(spaceLabels: spaceLabels, subtasks: $subtasks, text: $subtaskText, literal: $subtaskLiteral, focused: $subtaskFocused) { submit() }
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
            if !pills.isEmpty {
                SuggestionPills(pills: pills) { use($0, parsed, resolved) }
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
            HStack(spacing: 6) {
                chipRow(parsed, resolved)
                QuickAddMenu(
                    buttons: supported,
                    priority: resolved.priority,
                    onPriority: { draft.pick(priority: $0, context) },
                    onImage: { imageSource = $0 },
                    run: { run($0) }
                )
            }
            .animation(.snappy(duration: 0.16), value: parsed.tokens)

            HStack(spacing: 8) {
                ProjectChip(projectId: resolved.projectId, sectionId: resolved.sectionId) { projectId, sectionId in
                    draft.pick(projectId: projectId, sectionId: sectionId, context)
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
                    .disabled((parsed.title.isEmpty && drafted.isEmpty) || loadingImages > 0)
            }
        }
        .animation(.snappy(duration: 0.2), value: subtasksOpen)
        .animation(.snappy(duration: 0.2), value: pills)
        .animation(.snappy(duration: 0.2), value: drafted)
        .imageSource($imageSource) { addImages($0) }
        .padding(.horizontal, 16)
        .padding(.top, 20)
        .padding(.bottom, 8)
        .frame(maxWidth: .infinity)
        .overlay(alignment: .top) { grabber }
        .background {
            // Runs under the home indicator when the keyboard is down, and on behind the keyboard when it is up, so the
            // keyboard's rounded top corners show the card instead of the scrim.
            Color.clear
                .glassEffect(.regular, in: UnevenRoundedRectangle(topLeadingRadius: 32, topTrailingRadius: 32, style: .continuous))
                .ignoresSafeArea(edges: .bottom)
        }
        // A tap between controls, or just beside the plain mic glyph, would otherwise reach the scrim and close the card.
        .contentShape(.rect)
        .offset(y: lift)
        // The labels picker lists, and creates in, the space the task will land in, as the web's draft home does.
        .environment(\.space, store.creationSpace(projectId: resolved.projectId, labelIds: resolved.labelIds))
        .environment(\.namesFromEverySpace, true)
        .sensoryFeedback(.selection, trigger: draft.picked)
        .sensoryFeedback(.success, trigger: saves)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("Quick add")
        .onAppear {
            focused = true
            draft.startAtPlace(spaceLabels)
        }
        .onChange(of: pillInputs(parsed, resolved), initial: true) { _, inputs in
            pills = suggestionPills(inputs)
        }
        .task(id: store.allTasks.count) {
            let tasks = store.allTasks.filter { $0.parentId == nil }
            suggestionIndex = await Task.detached(priority: .userInitiated) { TaskSuggestions.index(tasks) }.value
        }
        .onChange(of: subtaskFocused) {
            if !subtaskFocused, subtaskText.isEmpty, subtasks.isEmpty { subtasksOpen = false }
        }
    }

    private var plainTextChip: some View {
        Button {
            draft.literal.toggle()
        } label: {
            Chip(systemImage: "textformat", text: "", tone: draft.literal ? .accent : .muted, fill: draft.literal ? .accent : nil)
                .contentShape(.rect.inset(by: -6))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Plain text")
        .accessibilityValue(draft.literal ? "On" : "Off")
        .accessibilityAddTraits(draft.literal ? .isSelected : [])
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

    private var imagesChip: some View {
        Menu {
            ImageSourceButtons { imageSource = $0 }
        } label: {
            Chip(systemImage: "photo", text: drafted.isEmpty ? "" : "\(drafted.count)", tone: drafted.isEmpty ? .muted : .ink)
                .contentShape(.rect.inset(by: -6))
        }
        .accessibilityLabel(drafted.isEmpty ? "Add image" : "Add image, \(drafted.count) added")
    }

    private var draftedImages: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 8) {
                ForEach(Array(drafted.enumerated()), id: \.element.id) { index, image in
                    Group {
                        if let preview = image.preview {
                            Image(uiImage: preview).resizable().aspectRatio(contentMode: .fill)
                        } else {
                            Color.ink.opacity(0.06)
                        }
                    }
                    .frame(width: 56, height: 56)
                    .clipShape(.rect(cornerRadius: 12))
                    .accessibilityElement()
                    .accessibilityLabel("Image \(index + 1) of \(drafted.count)")
                    .overlay(alignment: .topTrailing) {
                        Button {
                            drafted.removeAll { $0.id == image.id }
                        } label: {
                            Image(systemName: "xmark")
                                .font(.system(size: 9, weight: .bold))
                                .foregroundStyle(.background)
                                .frame(width: 20, height: 20)
                                .background(.ink, in: .circle)
                                .frame(width: 44, height: 44)
                                .contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                        .offset(x: 14, y: -14)
                        .accessibilityLabel("Remove image \(index + 1)")
                    }
                    .transition(.scale(scale: 0.85).combined(with: .opacity))
                }
                ForEach(0 ..< loadingImages, id: \.self) { _ in
                    RoundedRectangle(cornerRadius: 12)
                        .fill(.ink.opacity(0.06))
                        .frame(width: 56, height: 56)
                        .overlay { ProgressView() }
                        .accessibilityLabel("Adding image")
                }
            }
            .padding(.vertical, 8)
            .padding(.trailing, 8)
        }
        .scrollIndicators(.hidden)
        .scrollClipDisabled()
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Images to attach")
    }

    private func addImages(_ load: @escaping ImageLoad) {
        focused = true
        loadingImages += 1
        Task {
            defer { loadingImages -= 1 }
            for data in await load() {
                let preview = await Task.detached(priority: .userInitiated) { DraftImage.preview(data) }.value
                drafted.append(DraftImage(data: data, preview: preview.map(UIImage.init)))
            }
        }
    }

    /// Dragging the grabber up, or tapping it, opens the draft in task details, the full editor.
    private var grabber: some View {
        Capsule()
            .fill(Color.ink.opacity(0.25))
            .frame(width: 36, height: 5)
            .frame(maxWidth: .infinity, minHeight: 20)
            .contentShape(.rect)
            .gesture(
                DragGesture(minimumDistance: 4)
                    .onChanged { value in
                        let pull = -value.translation.height
                        lift = pull > 0 ? -pow(pull, 0.7) : min(-pull, 40) * 0.25
                    }
                    .onEnded { value in
                        let opens = value.translation.height < -60 || value.predictedEndTranslation.height < -160
                        withAnimation(.snappy) { lift = 0 }
                        if opens { expand() }
                    }
            )
            .onTapGesture { expand() }
            .accessibilityElement()
            .accessibilityLabel("Open in task details")
            .accessibilityAddTraits(.isButton)
            .accessibilityAction { expand() }
            .accessibilityIdentifier("Quick add grabber")
    }

    private var micButton: some View {
        Button {
            navigator.sheet = .ramble(draft.defaults)
        } label: {
            Image(systemName: "mic.fill")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.white)
                .frame(width: QuickAddMetrics.cornerButton, height: QuickAddMetrics.cornerButton)
                .glassEffect(.regular.tint(.accent).interactive(), in: .circle)
                // Flush right, so it sits on the same edge as the `+` below it.
                .frame(width: 44, height: 44, alignment: .trailing)
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Ramble")
    }

    /// One line that scrolls sideways, faded at whichever end has more chips past it.
    private func chipRow(_ parsed: QuickAdd.Parsed, _ resolved: Resolved) -> some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal) {
                HStack(spacing: 6) {
                    chips(parsed, resolved)
                }
                .padding(.vertical, 6)
            }
            .scrollIndicators(.hidden)
            .onScrollGeometryChange(for: RowFade.self) { geometry in
                RowFade(
                    start: geometry.contentOffset.x > 1,
                    end: geometry.contentOffset.x + geometry.containerSize.width < geometry.contentSize.width - 1
                )
            } action: { _, value in
                fade = value
            }
            .mask {
                HStack(spacing: 0) {
                    LinearGradient(colors: [.clear, .black], startPoint: .leading, endPoint: .trailing)
                        .frame(width: fade.start ? 20 : 0)
                    Color.black
                    LinearGradient(colors: [.black, .clear], startPoint: .leading, endPoint: .trailing)
                        .frame(width: fade.end ? 20 : 0)
                }
            }
            .onChange(of: scrollTarget) {
                guard let scrollTarget else { return }
                withAnimation(.snappy) { proxy.scrollTo(scrollTarget) }
                self.scrollTarget = nil
            }
        }
        .padding(.vertical, -6)
    }

    private typealias Resolved = (due: Due?, priority: Priority, projectId: String?, sectionId: String?, labelIds: [String])

    /// Each attribute that holds something shows in the row even when it is not pinned.
    private func filled(_ parsed: QuickAdd.Parsed, _ resolved: Resolved) -> [QuickAddButton] {
        var buttons: [QuickAddButton] = []
        if resolved.due != nil { buttons.append(.date) }
        if resolved.priority != .default { buttons.append(.priority) }
        if !draft.picked.reminders.isEmpty || !parsed.reminders.isEmpty { buttons.append(.reminders) }
        if parsed.recurrence ?? draft.picked.recurrence != nil { buttons.append(.repeat) }
        if !resolved.labelIds.isEmpty { buttons.append(.labels) }
        if subtasksOpen || !subtasks.isEmpty { buttons.append(.subtasks) }
        if !drafted.isEmpty { buttons.append(.images) }
        if (parsed.location ?? draft.picked.location) != nil { buttons.append(.location) }
        if draft.picked.event != nil { buttons.append(.event) }
        return buttons
    }

    /// An event stands in for the date and the repeat, as in task details.
    private var supported: [QuickAddButton] {
        draft.picked.event == nil ? QuickAddButton.allCases : QuickAddButton.allCases.filter { $0 != .date && $0 != .repeat }
    }

    @ViewBuilder
    private func chips(_ parsed: QuickAdd.Parsed, _ resolved: Resolved) -> some View {
        let buttons = QuickAddButtons.rowButtons(store.quickAddButtons, opened + filled(parsed, resolved), supported)
        plainTextChip
        ForEach(buttons) { button in
            chip(button, parsed, resolved).id(button)
        }
        // The name the suggestion list is open on already offers to create it there.
        ForEach(draft.literal ? [] : NameSearch.unknownNames(draft.text, parsed.tokens, spaceProjects, spaceLabels).filter { $0.start != listAt }, id: \.self) { name in
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

    @ViewBuilder
    private func chip(_ button: QuickAddButton, _ parsed: QuickAdd.Parsed, _ resolved: Resolved) -> some View {
        let trigger = openTriggers[button, default: 0]
        switch button {
        case .date:
            DueChip(due: resolved.due, openTrigger: trigger) { draft.pick(due: $0, context) }
        case .priority:
            PriorityChip(priority: resolved.priority, iconOnly: true) { draft.pick(priority: $0, context) }
        case .reminders:
            ReminderChip(reminders: draft.picked.reminders, due: resolved.due, openTrigger: trigger) {
                draft.picked.reminders = $0
            }
            let reminders = zip(parsed.tokens.filter { $0.kind == .reminder }, parsed.reminders).map(ParsedReminder.init)
            ForEach(reminders, id: \.self) { item in
                Chip(systemImage: "bell.fill", text: Format.formatReminder(item.reminder, clock.today), tone: .toneWeek)
            }
        case .repeat:
            RepeatChip(recurrence: parsed.recurrence ?? draft.picked.recurrence, due: resolved.due, openTrigger: trigger) {
                draft.pick(recurrence: $0, start: $1, due: resolved.due, context)
            }
        case .labels:
            let place = parsed.location ?? draft.picked.location
            LabelsChip(labelIds: Triggers.pickedLabels(spaceLabels, labelIds: resolved.labelIds, location: place), openTrigger: trigger) {
                let applied = Triggers.applyPickedLabels(spaceLabels, $0, place)
                draft.pick(labelIds: applied.labelIds, parsed, context)
                if applied.location != place { draft.pick(location: applied.location, context) }
            }
        case .subtasks:
            subtaskChip
        case .images:
            imagesChip
        case .location:
            LocationChip(location: parsed.location ?? draft.picked.location, openTrigger: trigger) { draft.pick(location: $0, context) }
        case .event:
            EventChip(event: draft.picked.event, openTrigger: trigger) { draft.picked.event = $0 }
        }
    }

    /// Runs a `+` menu action: the checklist opens its field, and every other button opens its picker in the row.
    private func run(_ button: QuickAddButton) {
        if button == .subtasks {
            subtasksOpen = true
            subtaskFocused = true
            return
        }
        if !opened.contains(button) { opened.append(button) }
        scrollTarget = button
        Task {
            // The menu has to finish closing before a popover can present from the chip.
            try? await Task.sleep(for: .milliseconds(350))
            openTriggers[button, default: 0] += 1
        }
    }

    /// Everything the pills depend on besides the index. Holding a project or label that appears or goes
    /// while the card is open reruns them too.
    private func pillInputs(_ parsed: QuickAdd.Parsed, _ resolved: Resolved) -> PillInputs {
        PillInputs(
            title: parsed.title,
            draft: .init(
                projectId: resolved.projectId,
                sectionId: resolved.sectionId,
                labelIds: resolved.labelIds,
                location: parsed.location ?? draft.picked.location
            ),
            available: .init(
                projectIds: spaceProjects.map(\.id),
                sectionIds: spaceSections.map(\.id),
                labelIds: store.labels(in: store.creationSpace(projectId: resolved.projectId, labelIds: resolved.labelIds)).map(\.id)
            ),
            ready: suggestionIndex != nil
        )
    }

    private func suggestionPills(_ inputs: PillInputs) -> [TaskSuggestions.Pill] {
        guard !inputs.title.isEmpty, let suggestionIndex else { return [] }
        return TaskSuggestions.pills(
            TaskSuggestions.suggest(suggestionIndex, inputs.title, now: clock.now.epochMilliseconds),
            draft: inputs.draft,
            available: inputs.available
        )
    }

    private func use(_ pill: TaskSuggestions.Pill, _ parsed: QuickAdd.Parsed, _ resolved: Resolved) {
        switch pill {
        case let .project(projectId, sectionId): draft.pick(projectId: projectId, sectionId: sectionId, context)
        case let .label(labelId): draft.pick(labelIds: resolved.labelIds + [labelId], parsed, context)
        case let .place(location): draft.pick(location: location, context)
        }
        focused = true
    }

    /// Creates a typed name only when its chip is tapped, so the parser then reads it like any other.
    private func create(_ name: NameSearch.UnknownName) {
        switch name.sigil {
        case .project: _ = store.addProject(name.name)
        case .label: _ = store.addLabel(name.name)
        case .section: break
        }
        focused = true
    }

    /// Saves the task with its subtasks and images.
    private func save(untitled: Bool = false) -> TaskItem? {
        guard loadingImages == 0 else { return nil }
        guard let task = draft.resolve(draft.parse(context), untitled: untitled, images: drafted.count) else { return nil }
        let typing = DraftSubtask(text: subtaskText, literal: subtaskLiteral)
            .parsed(now: clock.now, labels: spaceLabels, in: clock.timeZone, literal: subtaskLiteral)
        let children = subtasks.compactMap { $0.task(now: clock.now, labels: spaceLabels, in: clock.timeZone) } + (typing.map { [$0] } ?? [])
        let added: TaskItem? = withAnimation(.snappy) {
            guard let added = store.addTask(task) else { return nil }
            for child in children { _ = store.addTask(child, parentId: added.id) }
            return added
        }
        guard let added else { return nil }
        let sources = drafted.map(\.data)
        if !sources.isEmpty { Task { [images] in await images.attach(added.id, sources) } }
        navigator.reuseAdded(added)
        return added
    }

    /// Quick add stays open for the next task, which starts where this one went, with the keyboard still up.
    private func submit() {
        guard let added = save() else { return }
        confirm(added)
        saves += 1
        focused = true
        withAnimation(.snappy(duration: 0.2)) {
            draft = QuickAddDraft(defaults: Screens.reusedDefaults(added, store.labels, date: draft.defaults.date))
            draft.startAtPlace(spaceLabels)
            subtasks = []
            subtaskText = ""
            subtaskLiteral = false
            subtasksOpen = false
            opened = []
            drafted = []
        }
    }

    /// Nothing navigates while quick add stays open: the open list flashes the row when it shows the task, and
    /// otherwise a toast names the list it went to, with a `Show` that closes quick add and goes there. Each save
    /// replaces the last one's toast, so a batch leaves one.
    private func confirm(_ task: TaskItem) {
        if let confirmation { toasts.dismiss(confirmation) }
        confirmation = nil
        guard let route = navigator.destination(of: task, labels: store.labels, today: clock.today, in: clock.timeZone) else {
            return navigator.flash(task.id)
        }
        let name = switch route {
        case let .project(id): store.project(id)?.name ?? "its project"
        case .noDate: "No date"
        default: "Inbox"
        }
        confirmation = toasts.show("Added to \(name)", action: .init(label: "Show") { [navigator, store, clock] in
            if navigator.quickAdd != nil { navigator.sheet = nil }
            navigator.reveal(task, labels: store.labels, today: clock.today, in: clock.timeZone)
        })
    }

    /// The full editor is task details, so expanding saves the draft, even untitled, closes quick add, and opens it there.
    private func expand() {
        guard let added = save(untitled: true) else { return }
        navigator.sheet = nil
        navigator.reveal(added, labels: store.labels, today: clock.today, in: clock.timeZone)
        navigator.sheet = .details(taskID: added.id)
    }
}

private struct DraftImage: Identifiable, Equatable {
    let id = UUID()
    let data: Data
    let preview: UIImage?

    /// Decoding a full-size photo on the main actor stalls the card, so callers run this off it.
    nonisolated static func preview(_ data: Data) -> CGImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: 336,
        ]
        return CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
    }

    static func == (a: DraftImage, b: DraftImage) -> Bool { a.id == b.id }
}

/// The mic and the `+` are one size, so the two read as a column on the card's right edge.
enum QuickAddMetrics {
    static let cornerButton: CGFloat = 32
}

private struct RowFade: Equatable {
    var start = false
    var end = false
}

private struct PillInputs: Equatable {
    let title: String
    let draft: TaskSuggestions.Draft
    let available: TaskSuggestions.Available
    let ready: Bool
}

private struct ParsedReminder: Hashable {
    let token: QuickAdd.Token
    let reminder: Reminder
}
