import AppIntents
import Core

extension CompleteWidgetTaskIntent {
    func perform() async throws -> some IntentResult {
        await IntentEffects.complete(id: taskID)
        return .result()
    }
}

extension OpenAppLinkIntent {
    func perform() async throws -> some IntentResult {
        await IntentEffects.open(link)
        return .result()
    }
}
