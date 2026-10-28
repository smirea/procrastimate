import AppIntents
import Core

extension CompleteTaskInAppIntent {
    func perform() async throws -> some IntentResult {
        await IntentEffects.complete(id: taskID)
        await WidgetSync.leave(taskID)
        return .result()
    }
}

/// Widgets run this in their extension; the app's copy only completes, should the system ever run it here.
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
