import Observation

/// The selected tab, each tab's navigation path, and the presented sheet.
@MainActor @Observable
final class Navigator {
    var tab: AppTab = .inbox
    var paths: [AppTab: [Route]] = [:]
    var sheet: Sheet?

    /// Quick add's defaults while it is open. It shows as an overlay attached to the keyboard, not as a sheet.
    var quickAdd: QuickAddDefaults? {
        if case let .quickAdd(defaults) = sheet { defaults } else { nil }
    }
}
