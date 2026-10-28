import AppIntents
import Foundation

// Both targets build these, so a widget or a control can name them, and each target adds its own `perform`. The system
// performs a plain intent from a widget in the widget extension, and a `LiveActivityIntent` or an `openAppWhenRun`
// intent in the app's process.

/// A widget row's checkbox. It runs in the widget extension, which completes the task in the widgets' copy of the
/// data and redraws at once, then opens `CompleteTaskInAppIntent`. Starting the app takes seconds, so a checkbox that
/// went through the app first showed nothing for that long.
struct CompleteWidgetTaskIntent: AppIntent {
    static let title: LocalizedStringResource = "Complete Task from Widget"
    static let isDiscoverable = false

    @Parameter(title: "Task ID")
    var taskID: String

    init() {}

    init(taskID: String) {
        self.taskID = taskID
    }
}

/// Completes a task a widget checked off in the app's store, so it syncs, repeats, and notifies like a tap in the app.
struct CompleteTaskInAppIntent: LiveActivityIntent {
    static let title: LocalizedStringResource = "Complete Task"
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
