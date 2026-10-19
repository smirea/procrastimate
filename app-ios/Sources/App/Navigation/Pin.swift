import Core
import Foundation

extension Pin {
    var route: Route {
        switch self {
        case .inbox: .inbox
        case .tomorrow: .tomorrow
        case .thisWeek: .thisWeek
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

/// The catalog's groups as pins, for the tab menus and Settings.
struct PinGroup: Identifiable {
    let title: String
    let pins: [Pin]
    var id: String { title }
}

extension Store {
    /// Nil for a project or label that is gone, or not synced to this device yet; its pin stays stored but hidden.
    func label(of pin: Pin) -> PinLabel? {
        switch pin {
        case .inbox: PinLabel(title: "Inbox", systemImage: Pin.inbox.systemImage)
        case .tomorrow: PinLabel(title: "Tomorrow", systemImage: Pin.tomorrow.systemImage)
        case .thisWeek: PinLabel(title: "This week", systemImage: Pin.thisWeek.systemImage)
        case .noDate: PinLabel(title: "No date", systemImage: Pin.noDate.systemImage)
        case let .project(id): project(id).map { PinLabel(title: $0.name, systemImage: $0.systemImage) }
        case let .label(id): label(id).map { PinLabel(title: $0.name, systemImage: $0.systemImage()) }
        case let .place(_, name): PinLabel(title: name, systemImage: "mappin.and.ellipse")
        case let .event(_, title): PinLabel(title: title, systemImage: "calendar")
        }
    }

    /// Whether the pin's list exists. A place or an event exists only while open tasks point at it; every other list
    /// exists while its project or label does, which `label(of:)` already checks.
    func exists(_ pin: Pin, today: DateKey) -> Bool {
        switch pin {
        case let .place(key, _): !Views.placeTasks(tasks, key, in: timeZone).isEmpty
        case let .event(id, _): !Views.eventTasks(tasks, id, today, in: timeZone).isEmpty
        case .inbox, .tomorrow, .thisWeek, .noDate, .project, .label: true
        }
    }

    /// Every top-level list, from the one catalog Browse and the tab menus share.
    func listCatalog(today: DateKey) -> [Lists.Group] {
        Lists.catalog(own: (tasks, snapshot.projects, labels), shared: sharedSpaces, today: today, in: timeZone)
    }

    /// Every list in the catalog's order, leaving out the ones already pinned.
    func pinGroups(excluding pinned: [Pin], today: DateKey) -> [PinGroup] {
        let taken = Set(pinned.map(\.key))
        return listCatalog(today: today)
            .map { group in PinGroup(title: group.title, pins: group.entries.map(Pin.init).filter { !taken.contains($0.key) }) }
            .filter { !$0.pins.isEmpty }
    }
}

extension Pin {
    /// The symbol of a list that always exists, shared by its tab and its Browse row.
    var systemImage: String {
        switch self {
        case .inbox: "tray"
        case .tomorrow: "sunrise"
        case .thisWeek: "calendar.day.timeline.left"
        case .noDate: "calendar.badge.minus"
        case .project: "number"
        case .label: "tag"
        case .place: "mappin.and.ellipse"
        case .event: "calendar"
        }
    }
}
