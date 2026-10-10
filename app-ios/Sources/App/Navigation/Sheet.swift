/// Every sheet. Only one shows at a time: presenting another replaces it, as on the web.
enum Sheet: Identifiable, Hashable {
    case quickAdd(QuickAddDefaults)
    case details(taskID: String)
    case search
    case settings

    var id: Self { self }
}

/// What a new task starts with, from the list quick add opened in.
struct QuickAddDefaults: Hashable {
    var projectID: String?
    var labelID: String?
    var today = false
}
