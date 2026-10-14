import Core
import SwiftUI

/// On an event task the presets count back from the event's moment and stand alone.
struct ReminderChip: View {
    @Environment(\.clock) private var clock
    let reminders: [Reminder]
    let due: Due?
    var relativeOnly = false
    let onChange: ([Reminder]) -> Void

    @State private var open = false

    var body: some View {
        Button {
            open = true
        } label: {
            Chip(
                systemImage: reminders.isEmpty ? "bell" : "bell.fill",
                text: reminders.isEmpty ? "Remind" : "\(reminders.count)",
                tone: reminders.isEmpty ? .muted : .ink,
                iconTone: reminders.isEmpty ? nil : .toneWeek
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(ReminderMenu.chipLabel(reminders.count))
        .popover(isPresented: $open) {
            ReminderPopover(
                reminders: reminders, due: due, today: clock.today, relativeOnly: relativeOnly, onChange: onChange
            ) { open = false }
                .presentationCompactAdaptation(.popover)
        }
    }
}

private struct ReminderPopover: View {
    @Environment(\.clock) private var clock
    let reminders: [Reminder]
    let due: Due?
    let today: DateKey
    let relativeOnly: Bool
    let onChange: ([Reminder]) -> Void
    let close: () -> Void

    @State private var date: Date?
    @State private var time: Date?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(reminders.enumerated()), id: \.offset) { index, reminder in
                HStack(spacing: 8) {
                    Image(systemName: "bell.fill").imageScale(.small).foregroundStyle(.toneWeek)
                    Text(Format.formatReminder(reminder, today)).foregroundStyle(.ink)
                    Spacer(minLength: 8)
                    Button {
                        var next = reminders
                        next.remove(at: index)
                        onChange(next)
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
                    .accessibilityLabel("Remove reminder")
                }
                .padding(.leading, 10)
                .frame(minHeight: 44)
            }
            if !reminders.isEmpty { Divider().padding(.vertical, 4) }

            Text(relativeOnly ? (due?.time == nil ? "Before the event · needs a time" : "Before the event")
                : ReminderMenu.sectionTitle(due))
                .font(.caption.weight(.medium))
                .textCase(.uppercase)
                .foregroundStyle(.faint)
                .padding(.horizontal, 10)
                .padding(.top, 4)
            ForEach(ReminderMenu.presets, id: \.self) { minutes in
                MenuRow(text: Format.formatReminder(.before(minutes: minutes), today)) {
                    add(.before(minutes: minutes))
                }
                .disabled(due?.time == nil)
                .opacity(due?.time == nil ? 0.4 : 1)
            }

            if !relativeOnly { custom }
        }
        .padding(8)
        .frame(width: 300)
    }

    @ViewBuilder private var custom: some View {
            Divider().padding(.vertical, 4)

            HStack(spacing: 8) {
                DatePicker("Reminder date", selection: dateBinding, displayedComponents: .date)
                    .labelsHidden()
                    .accessibilityLabel("Reminder date")
                DatePicker("Reminder time", selection: timeBinding, displayedComponents: .hourAndMinute)
                    .labelsHidden()
                    .accessibilityLabel("Reminder time")
            }
            .environment(\.timeZone, clock.timeZone)
            .environment(\.calendar, clock.calendar)
            .padding(.horizontal, 8)
            Button("Add reminder") {
                let parts = clock.calendar.dateComponents([.hour, .minute], from: timeBinding.wrappedValue)
                add(ReminderMenu.at(
                    date: date.map { Dates.toDateKey($0, in: clock.timeZone) },
                    time: Dates.toTimeOfDay(hours: parts.hour ?? 9, minutes: parts.minute ?? 0),
                    due: due,
                    today: today
                ))
            }
            .buttonStyle(.bordered)
            .buttonBorderShape(.capsule)
            .frame(maxWidth: .infinity)
            .padding(8)
    }

    /// Unset until picked, so the reminder falls back to the due date, like the web's empty date field.
    private var dateBinding: Binding<Date> {
        Binding(
            get: { date ?? Dates.fromDateKey(due?.date ?? today, in: clock.timeZone) },
            set: { date = $0 }
        )
    }

    private var timeBinding: Binding<Date> {
        Binding(
            get: { time ?? Dates.fromDateKey(due?.date ?? today, "09:00", in: clock.timeZone) },
            set: { time = $0 }
        )
    }

    private func add(_ reminder: Reminder) {
        if let next = ReminderMenu.adding(reminder, to: reminders) { onChange(next) }
        close()
    }
}
