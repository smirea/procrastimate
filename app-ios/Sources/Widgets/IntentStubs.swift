import AppIntents

// The system runs these in the app (see `WidgetIntents.swift`); the extension only needs them to compile.

extension CompleteWidgetTaskIntent {
    func perform() async throws -> some IntentResult { .result() }
}

extension OpenAppLinkIntent {
    func perform() async throws -> some IntentResult { .result() }
}
