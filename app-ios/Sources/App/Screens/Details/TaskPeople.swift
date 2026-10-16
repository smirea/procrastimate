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
                    ForEach(Array(entries.enumerated()), id: \.offset) { _, entry in
                        ActivityRow(entry: entry, now: clock.now)
                    }
                }
            }
        }
        .padding(.horizontal, 4)
        .padding(.bottom, shown ? 16 : 0)
        .task(id: task.id) { await load() }
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
    let now: Date

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            PersonName(person: entry.actor, you: entry.actor.id == Session.userID)
                .fontWeight(.medium)
            Text(summary).foregroundStyle(.muted).lineLimit(1)
            Spacer(minLength: 8)
            Text(ago).font(.caption).foregroundStyle(.faint)
        }
        .font(.subheadline)
        .accessibilityElement(children: .combine)
    }

    private var summary: String {
        guard entry.action == .edited, !entry.fields.isEmpty else { return "\(entry.action.rawValue) it" }
        return "changed " + entry.fields.map { Self.fieldNames[$0] ?? $0 }.joined(separator: ", ")
    }

    private var ago: String {
        let at = Date(timeIntervalSince1970: Double(entry.at) / 1000)
        guard abs(at.timeIntervalSince(now)) >= 60 else { return "just now" }
        return at.formatted(.relative(presentation: .numeric, unitsStyle: .abbreviated))
    }

    private static let fieldNames = ["projectId": "project", "labelIds": "labels", "parentId": "parent"]
}
