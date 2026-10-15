import Core
import SwiftUI

/// Every task completed in the chosen range, under the day it was completed, newest first. The range is a preset
/// that follows today, or a custom pair of days.
struct CompletedScreen: View {
    @Environment(Store.self) private var store
    @Environment(\.today) private var today
    @AppStorage("completedPreset") private var preset = Views.CompletedPreset.week.rawValue
    @AppStorage("completedFrom") private var from = ""
    @AppStorage("completedTo") private var to = ""
    @State private var choosingCustom = false

    private static let custom = "custom"

    private var range: Views.CompletedRange {
        Views.CompletedPreset(rawValue: preset).map { Views.completedRange($0, today) }
            ?? Views.CompletedRange(from: from.isEmpty ? nil : from, to: to.isEmpty ? nil : to)
    }

    var body: some View {
        let range = range
        let days = Views.completedDays(store.tasks, range, in: store.timeZone)
        let label = Format.completedRangeLabel(range, today)
        TaskListScreen(
            title: "Completed",
            isEmpty: days.isEmpty,
            emptyTitle: "Nothing completed",
            emptyHint: range.from == nil && range.to == nil ? "Tasks you complete show up here." : "Pick a longer range to see more."
        ) {
            ForEach(days, id: \.date) { day in
                let heading = Format.completedHeading(day.date, today)
                Section {
                    ForEach(day.tasks) { CompletedRow(task: $0, showProject: true) }
                } header: {
                    ListHeading(text: heading, tasks: day.tasks)
                }
            }
        }
        .animation(.snappy, value: range)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Picker("Completed", selection: $preset) {
                        ForEach(Views.CompletedPreset.allCases) { preset in
                            Text(Format.completedRangeLabel(Views.completedRange(preset, today), today)).tag(preset.rawValue)
                        }
                    }
                    Button("Custom range…", systemImage: "calendar") { choosingCustom = true }
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "calendar")
                        Text(label).lineLimit(1)
                    }
                    .font(.subheadline.weight(.medium))
                    .padding(.horizontal, 6)
                }
                .accessibilityLabel("Completed \(label)")
                .accessibilityIdentifier("completed-range")
            }
        }
        .sheet(isPresented: $choosingCustom) {
            CustomRangeSheet(initial: range, today: today) { start, end in
                from = start
                to = end
                preset = Self.custom
            }
        }
        .sensoryFeedback(.selection, trigger: range)
    }
}

private struct CustomRangeSheet: View {
    @Environment(Store.self) private var store
    @Environment(\.dismiss) private var dismiss
    let initial: Views.CompletedRange
    let today: DateKey
    let apply: (DateKey, DateKey) -> Void

    @State private var start = Date()
    @State private var end = Date()

    var body: some View {
        let zone = store.timeZone
        let latest = Dates.fromDateKey(today, "23:59", in: zone)
        NavigationStack {
            Form {
                DatePicker("From", selection: $start, in: ...latest, displayedComponents: .date)
                DatePicker("To", selection: $end, in: ...latest, displayedComponents: .date)
            }
            .environment(\.timeZone, zone)
            .navigationTitle("Custom range")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Apply") {
                        let days = [Dates.toDateKey(start, in: zone), Dates.toDateKey(end, in: zone)].sorted()
                        apply(days[0], days[1])
                        dismiss()
                    }
                }
            }
        }
        .presentationDetents([.medium])
        .onAppear {
            start = Dates.fromDateKey(initial.from ?? today, in: zone)
            end = Dates.fromDateKey(initial.to ?? today, in: zone)
        }
    }
}
