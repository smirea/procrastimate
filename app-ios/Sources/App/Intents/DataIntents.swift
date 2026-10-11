import AppIntents
import Core

/// Wipes tasks, projects, and labels on this device. The next sync wipes them on the server too.
struct DeleteAllDataIntent: AppIntent {
    static let title: LocalizedStringResource = "Delete All Data"
    static let description = IntentDescription("Deletes every task, project, and label.")
    static let openAppWhenRun = true

    func perform() async throws -> some IntentResult {
        guard let session = IntentSession.current else { return .result() }
        session.store.deleteAll()
        await LocalNotifications.applySchedule(store: session.store, clock: session.clock)
        return .result()
    }
}
