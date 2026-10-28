import AppIntents

extension CompleteWidgetTaskIntent {
    func perform() async throws -> some IntentResult & OpensIntent {
        WidgetStore.check(taskID)
        return .result(opensIntent: CompleteTaskInAppIntent(taskID: taskID))
    }
}

// The system runs these in the app (see `WidgetIntents.swift`); the extension only needs them to compile.

extension CompleteTaskInAppIntent {
    func perform() async throws -> some IntentResult { .result() }
}

extension OpenAppLinkIntent {
    func perform() async throws -> some IntentResult { .result() }
}
