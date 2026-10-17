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
}
