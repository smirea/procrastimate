import Foundation

/// The port of `shared/lists.ts`: the top-level lists of tasks, every screen a user navigates to, pins, or picks a
/// list from. Browse, the tab bar, and its menus read this one catalog and only filter it for their use.
public enum Lists {
    public typealias Entry = API.ListEntry
    public typealias Group = API.ListGroup
    public typealias GroupKind = API.ListGroupKind
    public typealias Kind = API.ListKind

    private static let titles: [GroupKind: String] = [
        .lists: "Lists", .projects: "Projects", .shared: "Shared with me", .places: "Places", .events: "Events",
        .labels: "Labels",
    ]

    private static let names: [Kind: String] = [.inbox: "Inbox", .tomorrow: "Tomorrow", .thisWeek: "This week", .noDate: "No date"]

    private static func rows(_ due: Views.DueDays) -> Int {
        due.overdue.count + due.today.count + due.days.reduce(0) { $0 + $1.tasks.count }
    }

    /// Every top-level list, grouped and in order, empty ones included: a list stays put while it has no tasks, so
    /// menus never shift under the user. Places and events exist only while open tasks point at them. Each count is the
    /// open rows its screen lists, except Inbox, which counts what its badge does: overdue and today's tasks. A shared
    /// list shows its owner instead of a count, so it counts 0.
    public static func catalog(
        own: (tasks: [TaskItem], projects: [Project], labels: [Label]),
        shared: [SharedSpace],
        today: DateKey,
        in zone: TimeZone
    ) -> [Group] {
        let (tasks, projects, labels) = own
        func fixed(_ kind: Kind, _ count: Int) -> Entry { Entry(kind: kind, id: kind.rawValue, name: names[kind]!, count: count) }
        let inbox = Views.dueDays(tasks, today, .inbox, in: zone)
        let counts = Views.openCounts(tasks, labels)
        let groups: [GroupKind: [Entry]] = [
            .lists: [
                fixed(.inbox, inbox.overdue.count + inbox.today.count),
                fixed(.tomorrow, rows(Views.dueDays(tasks, today, .tomorrow, in: zone))),
                fixed(.thisWeek, rows(Views.dueDays(tasks, today, .thisWeek, in: zone))),
                fixed(.noDate, Views.inboxTasks(tasks, today, in: zone).count),
            ],
            .projects: StoreRules.projectsInOrder(projects).map {
                Entry(kind: .project, id: $0.id, name: $0.name, count: counts.projects[$0.id] ?? 0)
            },
            .shared: SpaceRouting.sharedEntries(shared).compactMap { entry in
                switch entry.kind {
                case .project: Entry(kind: .project, id: entry.id, name: entry.name, count: 0, owner: entry.owner)
                case .label: Entry(kind: .label, id: entry.id, name: entry.name, count: 0, owner: entry.owner)
                case .task: nil
                }
            },
            .places: Triggers.placeGroups(tasks, labels).map { Entry(kind: .place, id: $0.key, name: $0.name, count: $0.count) },
            .events: Triggers.eventGroups(tasks, today, in: zone).map {
                Entry(kind: .event, id: $0.id, name: $0.title, count: $0.count)
            },
            .labels: Browse.labelsByName(labels).map {
                Entry(kind: .label, id: $0.id, name: $0.name, count: counts.labels[$0.id] ?? 0)
            },
        ]
        return GroupKind.allCases.map { Group(kind: $0, title: titles[$0]!, entries: groups[$0] ?? []) }
    }
}
