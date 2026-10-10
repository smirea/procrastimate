/// The main tabs, opening on Inbox like the web.
enum AppTab: Hashable {
    case inbox
    case today
    case upcoming
    case browse
    case search
}

/// Every screen pushed onto a tab's navigation stack.
enum Route: Hashable {
    case project(id: String)
    case label(id: String)
    case notifications
}
