import Core
import Foundation

extension Pin {
    var route: Route {
        switch self {
        case .inbox: .inbox
        case .noDate: .noDate
        case let .project(id): .project(id: id)
        case let .label(id): .label(id: id)
        case let .place(key, _): .place(key: key)
        case let .event(id, _): .event(id: id)
        }
    }
}

/// How a pin shows in the tab bar, its menus, and Settings.
struct PinLabel {
    let title: String
    let systemImage: String
}

/// Pins grouped the way Browse lists them, for the tab menus and Settings.
struct PinGroup: Identifiable {
    let title: String
    let pins: [Pin]
    var id: String { title }
}

extension Store {
    /// Nil for a project or label that is gone, or not synced to this device yet; its pin stays stored but hidden.
    func label(of pin: Pin) -> PinLabel? {
        switch pin {
        case .inbox: PinLabel(title: "Inbox", systemImage: "tray")
        case .noDate: PinLabel(title: "No date", systemImage: "calendar.badge.minus")
        case let .project(id): project(id).map { PinLabel(title: $0.name, systemImage: "number") }
        case let .label(id): label(id).map { PinLabel(title: $0.name, systemImage: "tag") }
        case let .place(_, name): PinLabel(title: name, systemImage: "mappin.and.ellipse")
        case let .event(_, title): PinLabel(title: title, systemImage: "calendar")
        }
    }

    /// Whether the pin's screen has open tasks. Inbox always counts, so the bar never loses its first tab.
    func hasOpenTasks(_ pin: Pin, today: DateKey) -> Bool {
        switch pin {
        case .inbox: true
        case .noDate: !Views.inboxTasks(tasks, today, in: timeZone).isEmpty
        case let .project(id):
            !Views.projectTasks(data(in: space(ofProject: id) ?? .own).tasks, id, in: timeZone).isEmpty
        case let .label(id):
            !Views.labelTasks(data(in: space(ofLabel: id) ?? .own).tasks, id, in: timeZone).isEmpty
        case let .place(key, _): !Views.placeTasks(tasks, key, in: timeZone).isEmpty
        case let .event(id, _): !Views.eventTasks(tasks, id, today, in: timeZone).isEmpty
        }
    }

    /// Every pinnable screen in Browse's order, leaving out the ones already pinned.
    func pinGroups(excluding pinned: [Pin], today: DateKey) -> [PinGroup] {
        let taken = Set(pinned.map(\.key))
        let shared = Browse.sharedEntries(sharedSpaces).compactMap { entry -> Pin? in
            switch entry.kind {
            case .project: .project(id: entry.id)
            case .label: .label(id: entry.id)
            case .task: nil
            }
        }
        let groups = [
            PinGroup(title: "Lists", pins: [.inbox, .noDate]),
            PinGroup(title: "Projects", pins: projects.map { .project(id: $0.id) }),
            PinGroup(title: "Shared with me", pins: shared),
            PinGroup(title: "Places", pins: Triggers.placeGroups(tasks).map { .place(key: $0.key, name: $0.name) }),
            PinGroup(
                title: "Events",
                pins: Triggers.eventGroups(tasks, today, in: timeZone).map { .event(id: $0.id, title: $0.title) }
            ),
            PinGroup(title: "Labels", pins: Browse.labelsByName(labels).map { .label(id: $0.id) }),
        ]
        return groups
            .map { PinGroup(title: $0.title, pins: $0.pins.filter { !taken.contains($0.key) }) }
            .filter { !$0.pins.isEmpty }
    }
}
