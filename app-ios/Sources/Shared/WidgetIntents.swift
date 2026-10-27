import AppIntents
import Foundation

// Both targets build these, so a widget or a control can name them, and each target adds its own `perform`. Only the
// app's runs: the system performs a `LiveActivityIntent` and an `openAppWhenRun` intent in the app's process.

/// A widget row's checkbox. Completing goes through the app's store, so it syncs, repeats, and notifies like a tap in
/// the app, and the app then rewrites the widget data.
struct CompleteWidgetTaskIntent: LiveActivityIntent {
    static let title: LocalizedStringResource = "Complete Task from Widget"
    static let isDiscoverable = false

    @Parameter(title: "Task ID")
    var taskID: String

    init() {}

    init(taskID: String) {
        self.taskID = taskID
    }
}

/// Opens the app on an `AppLink`, for controls, which run an intent rather than a URL.
struct OpenAppLinkIntent: AppIntent {
    static let title: LocalizedStringResource = "Open ProcrastiMate"
    static let isDiscoverable = false
    static let openAppWhenRun = true

    @Parameter(title: "Link")
    var link: URL

    init() {}

    init(link: URL) {
        self.link = link
    }
}
