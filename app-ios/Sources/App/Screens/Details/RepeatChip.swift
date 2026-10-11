import Core
import SwiftUI

/// The repeat chip and its popover: seven weekday toggles, Monday first, that keep it open, the presets, `Don’t
/// repeat`, and a custom interval. The rules are `RepeatMenu`'s.
struct RepeatChip: View {
    @Environment(\.clock) private var clock
    let recurrence: Recurrence?
    let due: Due?
    /// A repeat comes with the due date it starts on.
    let onChange: (Recurrence?, Due?) -> Void

    @State private var open = false
    @State private var opened: Due?

    var body: some View {
        let anchor = RepeatMenu.anchor(due, today: clock.today)
        Button {
            opened = anchor
            open = true
        } label: {
            Chip(
                systemImage: "repeat",
                text: recurrence.map { Format.formatRecurrence($0, due) } ?? "Repeat",
                tone: recurrence == nil ? .muted : .toneTomorrow
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(recurrence.map { Format.repeatLabel($0, due) } ?? "Set repeat")
        .popover(isPresented: $open) {
            RepeatPopover(recurrence: recurrence, anchor: anchor) { next in
                let set = RepeatMenu.set(next, opened: opened ?? anchor, due: due)
                onChange(set.recurrence, set.due)
            } close: {
                open = false
            }
            .presentationCompactAdaptation(.popover)
        }
    }
}

private struct RepeatPopover: View {
    let recurrence: Recurrence?
    let anchor: Due
    let set: (Recurrence?) -> Void
    let close: () -> Void

    @State private var interval = 2
    @State private var unit: RecurrenceUnit = .day

    var body: some View {
        let weekdays = RepeatMenu.weekdays(recurrence, anchor: anchor)
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 2) {
                ForEach(RepeatMenu.week, id: \.self) { day in
                    let on = weekdays.contains(day)
                    Button {
                        set(RepeatMenu.toggling(day, recurrence, anchor: anchor))
                    } label: {
                        Text(Format.weekdayNames[day].prefix(1))
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(on ? Color.white : Color.ink)
                            .frame(width: 36, height: 36)
                            .background(on ? Color.accent : Color.ink.opacity(0.05), in: .circle)
                            .frame(width: 44, height: 44)
                            .contentShape(.circle)
                    }
                    .buttonStyle(.plain)
                    .disabled(!RepeatMenu.canToggle(day, weekdays))
                    .accessibilityLabel(Format.weekdayNames[day])
                    .accessibilityAddTraits(on ? .isSelected : [])
                }
            }
            .animation(.snappy(duration: 0.16), value: weekdays)
            .sensoryFeedback(.selection, trigger: weekdays)
            .padding(.bottom, 4)

            Divider()

            ForEach(RepeatMenu.presets, id: \.unit) { preset in
                let selected = RepeatMenu.isSelected(preset, recurrence)
                MenuRow(text: Format.formatRecurrence(preset, anchor), checked: selected) {
                    set(preset)
                    close()
                }
            }
            if recurrence != nil {
                MenuRow(text: "Don’t repeat", tone: .muted) {
                    set(nil)
                    close()
                }
            }

            Divider().padding(.vertical, 4)

            HStack(spacing: 8) {
                Text("Every").foregroundStyle(.muted)
                TextField("Repeat interval", value: $interval, format: .number)
                    .keyboardType(.numberPad)
                    .multilineTextAlignment(.center)
                    .frame(width: 52, height: 36)
                    .background(.ink.opacity(0.05), in: .rect(cornerRadius: 10))
                    .accessibilityLabel("Repeat interval")
                Picker("Repeat unit", selection: $unit) {
                    ForEach(RepeatMenu.units, id: \.self) { Text("\($0.rawValue)s").tag($0) }
                }
                .pickerStyle(.menu)
                .accessibilityLabel("Repeat unit")
                Spacer(minLength: 0)
                Button("Set") {
                    guard RepeatMenu.intervals.contains(interval) else { return }
                    set(RepeatMenu.custom(interval, unit, recurrence))
                    close()
                }
                .buttonStyle(.bordered)
                .buttonBorderShape(.capsule)
                .disabled(!RepeatMenu.intervals.contains(interval))
            }
            .font(.subheadline)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
        }
        .padding(8)
        .frame(width: 340)
    }
}

/// A popover row with an optional checkmark, like the web's `.menu-item`.
struct MenuRow: View {
    let text: String
    var checked = false
    var tone: Color = .ink
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack {
                Text(text).foregroundStyle(tone)
                Spacer(minLength: 8)
                if checked {
                    Image(systemName: "checkmark").font(.subheadline.weight(.semibold)).foregroundStyle(.accent)
                }
            }
            .padding(.horizontal, 10)
            .frame(maxWidth: .infinity, minHeight: 44)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(text)
        .accessibilityAddTraits(checked ? .isSelected : [])
    }
}
