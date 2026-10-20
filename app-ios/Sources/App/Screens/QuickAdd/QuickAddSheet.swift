import Core
import ImageIO
import SwiftUI
import UIKit

/// Quick add: a glass card attached to the top of the keyboard with the smart input, the chips that spell out what
/// the text set, and the project picker. It is an overlay rather than a sheet, because a sheet floats above the
/// keyboard with a gap. Saving closes it and shows the new task in its list; dismissing discards the draft.
struct QuickAddSheet: View {
    @Environment(Store.self) private var store
    @Environment(Navigator.self) private var navigator
    @Environment(\.clock) private var clock
    @Environment(\.space) private var space
    @Environment(TaskImages.self) private var images

    /// Quick add from a shared project or label names only that space's projects and labels.
    private var spaceProjects: [Project] { store.projects(in: space) }
    private var spaceSections: [ProjectSection] { store.data(in: space).sections }
    private var spaceLabels: [Core.Label] { store.labels(in: space) }

    @State private var draft: QuickAddDraft
    @State private var listAt: Int?
    @State private var subtasks: [DraftSubtask] = []
    @State private var subtaskText = ""
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
            .padding(.trailing, showMic ? 36 : 0)
            .overlay(alignment: .trailing) {
                if showMic { micButton.transition(.scale(scale: 0.6).combined(with: .opacity)) }
            }
            .animation(.snappy(duration: 0.16), value: showMic)
            if !drafted.isEmpty || loadingImages > 0 {
                draftedImages.transition(.opacity.combined(with: .move(edge: .top)))
            }
            if subtasksOpen || !subtasks.isEmpty {
                QuickAddSubtasks(spaceLabels: spaceLabels, subtasks: $subtasks, text: $subtaskText, focused: $subtaskFocused) { submit() }
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
                    .disabled(parsed.title.isEmpty || loadingImages > 0)
            }
        }
        .animation(.snappy(duration: 0.2), value: subtasksOpen)
        .animation(.snappy(duration: 0.2), value: drafted)
        .imageSource($imageSource) { addImages($0) }
        .padding(.horizontal, 16)
        .padding(.top, 20)
        .padding(.bottom, 8)
        .frame(maxWidth: .infinity)
        .background {
            // Runs under the home indicator when the keyboard is down, and on behind the keyboard when it is up, so the
            // keyboard's rounded top corners show the card instead of the scrim.
            Color.clear
                .glassEffect(.regular, in: UnevenRoundedRectangle(topLeadingRadius: 32, topTrailingRadius: 32, style: .continuous))
                .ignoresSafeArea(edges: .bottom)
        }
        // A tap between controls, or just beside the plain mic glyph, would otherwise reach the scrim and close the card.
        .contentShape(.rect)
        .sensoryFeedback(.selection, trigger: draft.picked)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("Quick add")
        .onAppear {
            focused = true
            draft.startAtPlace(spaceLabels)
        }
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
        ForEach(buttons) { button in
            chip(button, parsed, resolved).id(button)
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

    /// Creates a typed name only when its chip is tapped, so the parser then reads it like any other.
    private func create(_ name: NameSearch.UnknownName) {
        switch name.sigil {
        case .project: _ = store.addProject(name.name)
        case .label: _ = store.addLabel(name.name)
        case .section: break
        }
        focused = true
    }

    private func submit() {
        guard loadingImages == 0 else { return }
        guard let task = draft.resolve(draft.parse(context)) else { return }
        let typing = NewTask(subtask: QuickAdd.parseSubtask(subtaskText, now: clock.now, labels: spaceLabels, in: clock.timeZone))
        let children = subtasks.map(\.task) + (typing.map { [$0] } ?? [])
        let added: TaskItem? = withAnimation(.snappy) {
            guard let added = store.addTask(task) else { return nil }
            for child in children { _ = store.addTask(child, parentId: added.id) }
            return added
        }
        guard let added else { return }
        let sources = drafted.map(\.data)
        if !sources.isEmpty { Task { [images] in await images.attach(added.id, sources) } }
        close(revealing: added.id)
    }

    private func close(revealing taskID: String) {
        navigator.sheet = nil
        if let task = store.task(taskID) { navigator.reveal(task, labels: store.labels, today: clock.today, in: clock.timeZone) }
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

private struct RowFade: Equatable {
    var start = false
    var end = false
}

private struct ParsedReminder: Hashable {
    let token: QuickAdd.Token
    let reminder: Reminder
}
