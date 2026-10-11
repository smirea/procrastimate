import AppIntents
import Core
import CoreSpotlight

/// Keeps Spotlight in step with open tasks. Completed and deleted tasks are removed, and a burst of edits is one index.
@MainActor
enum SpotlightIndex {
    private static var pending: Task<Void, Never>?

    static func schedule(_ session: IntentSession) {
        let open = IntentRules.indexedTasks(session.store.tasks)
        session.router.spotlight = open.map(\.title).sorted().joined(separator: ", ")
        let entities = open.map {
            TaskEntity.make($0, projects: session.store.projects, labels: session.store.labels, today: session.clock.today)
        }
        pending?.cancel()
        pending = Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            await index(entities)
        }
    }

    private static func index(_ entities: [TaskEntity]) async {
        let spotlight = CSSearchableIndex.default()
        do {
            try await spotlight.deleteAppEntities(ofType: TaskEntity.self)
            guard !entities.isEmpty, !Task.isCancelled else { return }
            try await spotlight.indexAppEntities(entities)
        } catch {
            // The simulator can refuse an index while it is busy. The next edit tries again.
        }
    }
}
