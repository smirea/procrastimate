enum AppTab: Hashable {
    case inbox
    case noDate
    case browse
    /// Not a screen: selecting it opens quick add and leaves the current tab selected.
    case add
}

enum Route: Hashable {
    case project(id: String)
    case label(id: String)
    case place(key: String)
    case event(id: String)
}
