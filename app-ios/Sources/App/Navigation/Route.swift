enum AppTab: Hashable {
    case inbox
    case today
    case upcoming
    case browse
    case search
}

enum Route: Hashable {
    case project(id: String)
    case label(id: String)
    case place(key: String)
    case event(id: String)
}
