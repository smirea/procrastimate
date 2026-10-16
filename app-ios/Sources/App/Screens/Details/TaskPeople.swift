import Core
import SwiftUI

/// Who made and finished the task, from the synced `createdBy` and `completedBy` and the people cache, so it shows
/// offline, then the task's activity from the server's log while online. Only a shared task, or one someone else
/// touched, shows any of it, so a solo list stays as clean as before.
struct TaskPeople: View {
    @Environment(Store.self) private var store
    @Environment(\.space) private var space
    @Environment(\.clock) private var clock
    let task: TaskItem

    @State private var entries: [API.ActivityEntry] = []

    var body: some View {
        let me = Session.userID
        let createdBy = person(task.createdBy)
        let completedBy = task.completedAt == nil ? nil : person(task.completedBy)
        let shown = space != .own
            || [task.createdBy, task.completedBy].contains { $0 != nil && $0 != me }
            || entries.contains { $0.actor.id != me }
        // A stack that is always there, so the activity loads even while nothing shows yet.
        VStack(alignment: .leading, spacing: 8) {
            if shown {
                if createdBy != nil || completedBy != nil {
                    FlowLayout(spacing: 12) {
                        if let createdBy { byline("Created by", createdBy) }
                        if let completedBy { byline("Completed by", completedBy) }
                    }
                    .font(.subheadline)
                }
                if !entries.isEmpty {
                    Text("Activity")
                        .font(.caption.weight(.semibold))
                        .textCase(.uppercase)
                        .foregroundStyle(.muted)
                        .accessibilityAddTraits(.isHeader)
                    ForEach(days, id: \.key) { day in
                        VStack(alignment: .leading, spacing: 6) {
                            Text(Format.relativeDay(day.key, clock.today) ?? Format.dayHeading(day.key, clock.today))
                                .font(.caption.weight(.medium))
                                .foregroundStyle(.faint)
                                .accessibilityAddTraits(.isHeader)
                            ForEach(Array(day.entries.enumerated()), id: \.offset) { _, entry in
                                ActivityRow(entry: entry, zone: clock.timeZone)
                            }
                        }
                    }
                }
            }
        }
        .padding(.horizontal, 4)
        .padding(.bottom, shown ? 16 : 0)
        .task(id: task.id) { await load() }
    }

    /// Newest day first, each day's entries newest first, Todoist history style.
    private var days: [(key: DateKey, entries: [API.ActivityEntry])] {
        var groups: [(key: DateKey, entries: [API.ActivityEntry])] = []
        for entry in entries {
            let key = Dates.toDateKey(Date(epochMilliseconds: entry.at), in: clock.timeZone)
            if groups.last?.key == key { groups[groups.count - 1].entries.append(entry) } else { groups.append((key, [entry])) }
        }
        return groups
    }

    private func byline(_ label: String, _ person: Person) -> some View {
        HStack(spacing: 4) {
            Text(label).foregroundStyle(.muted)
            PersonName(person: person, you: person.id == Session.userID).foregroundStyle(.ink)
        }
        .accessibilityElement(children: .combine)
    }

    private func person(_ id: String?) -> Person? {
        guard let id else { return nil }
        if let known = store.person(id) { return known }
        return id == Session.userID ? Person(id: id, name: "You", kind: .human) : nil
    }

    private func load() async {
        guard let activity = try? await APIClient.send(
            API.Endpoints.ActivityList.self, NoInput(), query: ["space": space.query, "id": task.id]
        ) else { return }
        store.rememberPeople(activity.entries.map(\.actor))
        withAnimation(.snappy) { entries = activity.entries.reversed() }
    }
}

private struct ActivityRow: View {
    let entry: API.ActivityEntry
    let zone: TimeZone

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            PersonName(person: entry.actor, you: entry.actor.id == Session.userID)
                .fontWeight(.medium)
                .fixedSize()
            Text(entry.summary)
                .foregroundStyle(.muted)
                .frame(maxWidth: .infinity, alignment: .leading)
            Text(time).font(.caption).monospacedDigit().foregroundStyle(.faint)
        }
        .font(.subheadline)
        .accessibilityElement(children: .combine)
    }

    private var time: String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        let parts = calendar.dateComponents([.hour, .minute], from: Date(epochMilliseconds: entry.at))
        return Format.formatTime(String(format: "%02d:%02d", parts.hour ?? 0, parts.minute ?? 0))
    }
}
