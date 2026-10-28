import Core
import EventKit
import SwiftUI

/// The calendar event chip and its sheet: upcoming events, which moment of the event the task is on, and for a
/// repeating event whether it follows the series.
struct EventChip: View {
    let event: TaskEvent?
    /// Bumped to open the picker from outside, as quick add's `+` menu does.
    var openTrigger = 0
    let onChange: (TaskEvent?) -> Void

    var body: some View {
        PickerChip(
            label: event.map { "Event: \(Triggers.formatEvent($0))" } ?? "Add event",
            openTrigger: openTrigger,
            presentation: .sheet,
            startsOpen: PlacesDemo.has("sheet:event")
        ) {
            Chip(
                systemImage: event == nil ? "calendar.badge.plus" : "calendar.badge.clock",
                text: event.map(Triggers.formatEvent) ?? "Event",
                tone: event == nil ? .muted : .ink,
                iconTone: event == nil ? nil : .toneWeek,
                truncation: .middle
            )
        } content: { _ in
            EventSheet(event: event, onChange: onChange)
        }
    }
}

private struct EventSheet: View {
    @Environment(CalendarSync.self) private var calendar
    @Environment(\.dismiss) private var dismiss
    @Environment(\.clock) private var clock
    @Environment(\.openURL) private var openURL
    let event: TaskEvent?
    let onChange: (TaskEvent?) -> Void

    @State private var events: [EKEvent] = []
    @State private var loaded = false
    @State private var picked: EKEvent?
    @State private var timing: EventTiming
    @State private var onlyThis: Bool
    @State private var query = ""

    init(event: TaskEvent?, onChange: @escaping (TaskEvent?) -> Void) {
        self.event = event
        self.onChange = onChange
        _timing = State(initialValue: event.map { EventTiming(edge: $0.edge, minutes: $0.minutes) } ?? EventTiming())
        _onlyThis = State(initialValue: event.map { !$0.series } ?? false)
    }

    private var repeating: Bool { picked.map(CalendarSync.repeats) ?? (event?.series ?? false) }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Picker("Moment", selection: $timing.anchor) {
                        Text("Start").tag(EventTiming.Anchor.start)
                        Text("During").tag(EventTiming.Anchor.during)
                        Text("End").tag(EventTiming.Anchor.end)
                    }
                    .pickerStyle(.segmented)
                    .accessibilityIdentifier("event-anchor")
                    .listRowSeparator(.hidden)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                    if timing.anchor != .during { OffsetRow(timing: $timing) }
                    if repeating {
                        Toggle("Only this one", isOn: $onlyThis)
                            .disabled(picked == nil)
                    }
                } footer: {
                    if let preview { Text(Triggers.formatEvent(preview)) }
                }

                if loaded, !calendar.granted {
                    Section {
                        ContentUnavailableView(
                            "No calendar access",
                            systemImage: "calendar.badge.exclamationmark",
                            description: Text("Allow full calendar access to link tasks to events.")
                        )
                        Button("Open Settings") {
                            if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
                        }
                    }
                }

                ForEach(days, id: \.date) { day in
                    Section(Format.formatDate(day.date, clock.today)) {
                        ForEach(day.events, id: \.self) { item in
                            EventRow(event: item, selected: isSelected(item)) { picked = item }
                        }
                    }
                }

                if event != nil {
                    Section {
                        Button("Remove event", systemImage: "trash", role: .destructive) {
                            onChange(nil)
                            dismiss()
                        }
                        .foregroundStyle(.toneOverdue)
                    }
                }
            }
            .scrollDismissesKeyboard(.immediately)
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search events")
            .navigationTitle("Calendar event")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(role: .close) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save", systemImage: "checkmark", role: .confirm) { save() }
                        .disabled(preview == nil)
                }
            }
        }
        .sensoryFeedback(.selection, trigger: picked)
        .sensoryFeedback(.selection, trigger: timing)
        .task {
            await calendar.requestAccess()
            events = calendar.upcomingEvents()
            if let event {
                picked = events.first { item in
                    CalendarSync.id(item) == event.id
                        && (event.series || item.occurrenceDate.epochMilliseconds == event.occurrences[0].original)
                }
            }
            loaded = true
        }
    }

    /// The event as Save would write it.
    private var preview: TaskEvent? {
        if let picked {
            return calendar.taskEvent(picked, timing: timing, onlyThis: onlyThis, upcoming: events)
        }
        guard var event else { return nil }
        event.edge = timing.edge
        event.minutes = timing.minutes
        return event
    }

    private func save() {
        guard let preview else { return }
        onChange(preview)
        dismiss()
    }

    private func isSelected(_ item: EKEvent) -> Bool {
        guard let picked else { return false }
        return CalendarSync.id(item) == CalendarSync.id(picked) && item.occurrenceDate == picked.occurrenceDate
    }

    private var days: [(date: DateKey, events: [EKEvent])] {
        let needle = query.trimmingCharacters(in: .whitespaces)
        var days: [(date: DateKey, events: [EKEvent])] = []
        for item in events where needle.isEmpty || (item.title ?? "").localizedStandardContains(needle) {
            let date = Dates.toDateKey(item.startDate, in: clock.timeZone)
            if days.last?.date == date { days[days.count - 1].events.append(item) } else { days.append((date, [item])) }
        }
        return days
    }
}

/// `[5] [m h d w] [Before After]`: the amount is typed, so any offset is a few taps, and with none the task is at the
/// start or the end itself.
private struct OffsetRow: View {
    @Binding var timing: EventTiming
    @FocusState private var focused: Bool
    @State private var selection: TextSelection?

    var body: some View {
        HStack(spacing: 8) {
            TextField("0", text: amount, selection: $selection)
                .focused($focused)
                // Selecting the whole amount on focus makes a typed number replace it instead of joining it.
                .onChange(of: focused) { _, focused in
                    guard focused, timing.amount > 0 else { return }
                    let text = String(timing.amount)
                    selection = TextSelection(range: text.startIndex..<text.endIndex)
                }
                .keyboardType(.numberPad)
                .multilineTextAlignment(.center)
                .monospacedDigit()
                .frame(width: 48)
                .padding(.vertical, 6)
                .background(.quaternary, in: .rect(cornerRadius: 8))
                .accessibilityIdentifier("event-amount")
            Picker("Unit", selection: $timing.unit) {
                ForEach(EventTiming.Unit.allCases, id: \.self) { Text($0.short).tag($0) }
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("event-unit")
            Picker("Direction", selection: $timing.direction) {
                Text("Before").tag(EventTiming.Direction.before)
                Text("After").tag(EventTiming.Direction.after)
            }
            .pickerStyle(.segmented)
            .disabled(timing.amount == 0)
            .accessibilityIdentifier("event-direction")
        }
    }

    private var amount: Binding<String> {
        Binding(
            get: { timing.amount == 0 ? "" : String(timing.amount) },
            set: { timing.amount = Int(String($0.filter(\.isNumber).prefix(3))) ?? 0 }
        )
    }
}

private struct EventRow: View {
    @Environment(\.clock) private var clock
    let event: EKEvent
    let selected: Bool
    let pick: () -> Void

    var body: some View {
        Button(action: pick) {
            HStack(spacing: 10) {
                RoundedRectangle(cornerRadius: 2)
                    .fill(Color(cgColor: event.calendar.cgColor))
                    .frame(width: 4, height: 32)
                VStack(alignment: .leading, spacing: 2) {
                    Text(event.title ?? "Event").foregroundStyle(.ink).lineLimit(1)
                    HStack(spacing: 4) {
                        Text(times)
                        if CalendarSync.repeats(event) { Image(systemName: "repeat").imageScale(.small) }
                    }
                    .font(.footnote)
                    .foregroundStyle(.muted)
                }
                Spacer(minLength: 8)
                if selected {
                    Image(systemName: "checkmark").font(.body.weight(.semibold)).foregroundStyle(.accent)
                }
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("event-\(event.title ?? "")")
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private var times: String {
        guard !event.isAllDay else { return "All day" }
        return "\(time(event.startDate)) – \(time(event.endDate))"
    }

    private func time(_ date: Date) -> String {
        let parts = clock.calendar.dateComponents([.hour, .minute], from: date)
        return Format.formatTime(Dates.toTimeOfDay(hours: parts.hour ?? 0, minutes: parts.minute ?? 0))
    }
}
