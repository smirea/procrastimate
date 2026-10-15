import Core

/// Every sheet. Only one shows at a time: presenting another replaces it, as on the web.
enum Sheet: Identifiable, Hashable {
    case quickAdd(QuickAddDefaults)
    case details(taskID: String)
    case settings
    /// A public share link's read-only page.
    case sharedLink(token: String)

    var id: Self { self }
}

typealias QuickAddDefaults = QuickAddDraft.Defaults
