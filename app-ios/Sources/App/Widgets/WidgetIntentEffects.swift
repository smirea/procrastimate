import AppIntents
import Core

extension CompleteTaskInAppIntent {
    func perform() async throws -> some IntentResult {
        await IntentEffects.complete(id: taskID)
        await WidgetSync.leave(taskID)
        return .result()
    }
}

/// Widgets run this in their extension, but a plain intent may run in either target, so the app's copy strikes the row
/// the same way before completing it.
extension CompleteWidgetTaskIntent {
    func perform() async throws -> some IntentResult {
        WidgetStore.check(taskID)
        await IntentEffects.complete(id: taskID)
        await WidgetSync.leave(taskID)
        return .result()
    }
}

extension OpenAppLinkIntent {
    func perform() async throws -> some IntentResult {
        await IntentEffects.open(link)
        return .result()
    }
}
