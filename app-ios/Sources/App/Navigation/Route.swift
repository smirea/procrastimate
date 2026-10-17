import Core

/// A pinned screen's tab, or Browse, which always sits last.
enum AppTab: Hashable {
    case pin(Pin)
    case browse
}

enum Route: Hashable {
    /// Inbox and No date push from Browse while they are not pinned.
    case inbox
    case noDate
    case project(id: String)
    case label(id: String)
    case place(key: String)
    case event(id: String)
    case completed

    var screen: ListScreen {
        switch self {
        case .inbox: .inbox()
        case .noDate: .noDate
        case let .project(id): .project(id: id)
        case let .label(id): .label(id: id)
        case let .place(key): .place(key: key)
        case let .event(id): .event(id: id)
        case .completed: .completed
        }
    }
}
