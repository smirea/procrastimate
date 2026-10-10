import Observation

/// The selected tab, each tab's navigation path, and the presented sheet.
@MainActor @Observable
final class Navigator {
    var tab: AppTab = .inbox
    var paths: [AppTab: [Route]] = [:]
    var sheet: Sheet?
}
