import Core

/// Every sheet. Only one shows at a time: presenting another replaces it, as on the web.
enum Sheet: Identifiable, Hashable {
    case quickAdd(QuickAddDefaults)
    case details(taskID: String)
    case settings

    var id: Self { self }
}

typealias QuickAddDefaults = QuickAddDraft.Defaults
