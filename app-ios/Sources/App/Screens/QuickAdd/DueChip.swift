import Core
import SwiftUI

/// The date chip of quick add and task details. Its popover holds the presets, a calendar, and the time,
/// and every pick commits at once.
struct DueChip: View {
    @Environment(\.clock) private var clock
    let due: Due?
    /// Bumped to open the picker from outside, as quick add's `+` menu does.
    var openTrigger = 0
    let onChange: (Due?) -> Void

    @State private var open = false

    var body: some View {
        let today = clock.today
        Button {
            open = true
        } label: {
            Chip(
                systemImage: due == nil ? "calendar" : "calendar.circle.fill",
                text: due.map { Format.formatDue($0, today) } ?? "Date",
                tone: due.map { Format.dueTone($0, today).color } ?? .muted
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(due.map { "Due \(Format.formatDue($0, today))" } ?? "Set due date")
        .onChange(of: openTrigger) { open = true }
        .popover(isPresented: $open) {
            DuePopover(due: due, onChange: onChange) { open = false }
                .presentationCompactAdaptation(.popover)
        }
    }
}

private struct DuePopover: View {
    @Environment(\.clock) private var clock
    let due: Due?
    let onChange: (Due?) -> Void
    let close: () -> Void

    /// Set while the wheel shows. `base` is the due date when the wheel opened, so a task without a date
    /// keeps landing on the next occurrence of each time scrolled past, not on the first one's day.
    @State private var timeEdit: (value: Date, base: Due?)?

    var body: some View {
        let today = clock.today
        VStack(spacing: 0) {
            HStack(spacing: 6) {
                ForEach(Array(zip(QuickAddDraft.datePresets(today), Self.presetStyles)), id: \.0.label) { preset, style in
                    presetTile(preset.label, systemImage: style.icon, tone: style.tone, current: due?.date == preset.date) {
                        onChange(Due(date: preset.date, time: due?.time))
                        close()
                    }
                }
                presetTile("No date", systemImage: "nosign", tone: .muted, current: false) {
                    onChange(nil)
                    close()
                }
                .disabled(due == nil)
                .opacity(due == nil ? 0.4 : 1)
            }
            Divider().padding(.vertical, 4)
            if let timeEdit {
                timeEditor(timeEdit)
                    .transition(.move(edge: .trailing).combined(with: .opacity))
            } else {
                calendar
                    .transition(.move(edge: .leading).combined(with: .opacity))
            }
        }
        .padding(8)
        .frame(width: 340)
        .clipped()
        .animation(.snappy(duration: 0.25), value: timeEdit == nil)
    }

    private static let presetStyles: [(icon: String, tone: Color)] = [
        ("calendar", .toneToday), ("sun.max", .toneSoon), ("calendar.badge.plus", .toneWeek),
    ]

    /// Tiles instead of rows keep the popover short enough to fit above the keyboard in quick add.
    private func presetTile(
        _ label: String, systemImage: String, tone: Color, current: Bool, action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            VStack(spacing: 3) {
                Image(systemName: systemImage).font(.body).foregroundStyle(tone)
                Text(label).font(.caption.weight(.medium)).foregroundStyle(label == "No date" ? .muted : .ink).lineLimit(1)
            }
            .frame(maxWidth: .infinity, minHeight: 52)
            .background(current ? tone.opacity(0.14) : Color.ink.opacity(0.05), in: .rect(cornerRadius: 14))
            .contentShape(.rect(cornerRadius: 14))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        .accessibilityAddTraits(current ? .isSelected : [])
    }

    @ViewBuilder private var calendar: some View {
        let today = clock.today
        VStack(spacing: 0) {
            DatePicker(
                "Due date",
                selection: Binding(
                    get: { Dates.fromDateKey(due?.date ?? today, in: clock.timeZone) },
                    set: { onChange(Due(date: Dates.toDateKey($0, in: clock.timeZone), time: due?.time)) }
                ),
                displayedComponents: .date
            )
            .datePickerStyle(.graphical)
            .environment(\.timeZone, clock.timeZone)
            .environment(\.calendar, clock.calendar)
            Divider().padding(.vertical, 4)
            HStack(spacing: 4) {
                Button {
                    timeEdit = (anchor(today), due)
                } label: {
                    HStack(spacing: 10) {
                        Image(systemName: due?.time == nil ? "clock" : "clock.fill")
                            .foregroundStyle(due?.time == nil ? .muted : .accent)
                            .frame(width: 22)
                        Text(due?.time.map(Format.formatTime) ?? "Add time")
                            .foregroundStyle(due?.time == nil ? .muted : .ink)
                        Spacer(minLength: 8)
                    }
                    .padding(.horizontal, 10)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(due?.time.map { "Change time, \(Format.formatTime($0))" } ?? "Add time")
                if let due, due.time != nil {
                    Button {
                        onChange(Due(date: due.date, time: nil))
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(.muted)
                            .frame(width: 30, height: 30)
                            .background(.ink.opacity(0.05), in: .circle)
                            .frame(width: 44, height: 44)
                            .contentShape(.circle)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Remove time")
                    .transition(.scale.combined(with: .opacity))
                }
            }
            .animation(.snappy(duration: 0.2), value: due?.time)
        }
    }

    private func timeEditor(_ edit: (value: Date, base: Due?)) -> some View {
        VStack(spacing: 0) {
            HStack {
                Button {
                    timeEdit = nil
                } label: {
                    Image(systemName: "chevron.left")
                        .font(.body.weight(.semibold))
                        .frame(width: 44, height: 44)
                        .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Back to calendar")
                Text("Time").font(.headline)
                Spacer()
                Button("Set \(Format.formatTime(timeOfDay(edit.value)))") {
                    commit(edit.value, base: edit.base)
                    close()
                }
                .buttonStyle(.glassProminent)
                .accessibilityLabel("Set time")
            }
            DatePicker(
                "Due time",
                selection: Binding(
                    get: { edit.value },
                    set: { value in
                        timeEdit = (value, edit.base)
                        commit(value, base: edit.base)
                    }
                ),
                displayedComponents: .hourAndMinute
            )
            .datePickerStyle(.wheel)
            .labelsHidden()
            .environment(\.timeZone, clock.timeZone)
        }
    }

    private func commit(_ value: Date, base: Due?) {
        let now = clock.calendar.dateComponents([.hour, .minute], from: clock.now)
        onChange(Dates.dueAtTime(
            base, timeOfDay(value), today: clock.today,
            now: Dates.toTimeOfDay(hours: now.hour ?? 0, minutes: now.minute ?? 0)
        ))
    }

    private func timeOfDay(_ value: Date) -> TimeOfDay {
        let parts = clock.calendar.dateComponents([.hour, .minute], from: value)
        return Dates.toTimeOfDay(hours: parts.hour ?? 0, minutes: parts.minute ?? 0)
    }

    /// The time the wheel opens on: the set time, 9am on a later day, or the next half hour today.
    private func anchor(_ today: DateKey) -> Date {
        if let due, let time = due.time { return Dates.fromDateKey(due.date, time, in: clock.timeZone) }
        if let due, due.date > today { return Dates.fromDateKey(due.date, "09:00", in: clock.timeZone) }
        let parts = clock.calendar.dateComponents([.hour, .minute], from: clock.now)
        let minutes = (((parts.hour ?? 0) * 60 + (parts.minute ?? 0) + 29) / 30 * 30) % (24 * 60)
        return Dates.fromDateKey(today, Dates.toTimeOfDay(hours: minutes / 60, minutes: minutes % 60), in: clock.timeZone)
    }
}
