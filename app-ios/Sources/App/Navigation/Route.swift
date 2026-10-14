enum AppTab: Hashable {
    case inbox
    case noDate
    case browse
}

enum Route: Hashable {
    case project(id: String)
    case label(id: String)
    case place(key: String)
    case event(id: String)
}
