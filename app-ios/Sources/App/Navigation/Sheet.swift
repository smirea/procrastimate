import Core

/// Every sheet. Only one shows at a time: presenting another replaces it, as on the web.
enum Sheet: Identifiable, Hashable {
    /// `capture` opens quick add straight into an image source, as the `+` button's long press does.
    case quickAdd(QuickAddDefaults, capture: QuickAddCapture? = nil)
    /// The fullscreen voice capture. It opens listening and saves into the list quick add would have.
    case ramble(QuickAddDefaults)
    case details(taskID: String)
    case settings
    /// A public share link's read-only page.
    case sharedLink(token: String)

    var id: Self { self }

    var keepsWhenSignedOut: Bool {
        if case .sharedLink = self { true } else { false }
    }
}

enum QuickAddCapture: Hashable {
    case camera, library

    var source: ImageSource {
        switch self {
        case .camera: .camera
        case .library: .library
        }
    }
}

typealias QuickAddDefaults = QuickAddDraft.Defaults
