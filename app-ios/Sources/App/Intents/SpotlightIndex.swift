import AppIntents
import Core
import CoreSpotlight

/// Keeps Spotlight in step with open tasks. Completed and deleted tasks are removed, and a burst of edits is one index.
@MainActor
enum SpotlightIndex {
    private static var pending: Task<Void, Never>?

    static func schedule(_ session: IntentSession) {
        schedule(store: session.store, clock: session.clock, router: session.router)
    }

    /// Indexes the store's open tasks. `router` receives the titles the UI test reads back; a background intent has none.
    static func schedule(store: Store, clock: AppClock, router: IntentRouter?) {
        let entities = listed(in: store, today: clock.today, router: router)
        pending?.cancel()
        pending = Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            try? await replaceAll(entities)
        }
    }

    static func replaceAll(_ entities: [TaskEntity]) async throws {
        let spotlight = CSSearchableIndex.default()
        try await spotlight.deleteAppEntities(ofType: TaskEntity.self)
        guard !entities.isEmpty else { return }
        try await spotlight.indexAppEntities(entities, priority: 0)
    }

    static func replace(_ entities: [TaskEntity], removing ids: [String]) async throws {
        let spotlight = CSSearchableIndex.default()
        if !ids.isEmpty {
            try await spotlight.deleteAppEntities(identifiedBy: ids, ofType: TaskEntity.self)
        }
        guard !entities.isEmpty else { return }
        try await spotlight.indexAppEntities(entities, priority: 0)
    }

    private static func listed(in store: Store, today: DateKey, router: IntentRouter?) -> [TaskEntity] {
        let open = IntentRules.indexedTasks(store.tasks)
        router?.spotlight = open.map(\.title).sorted().joined(separator: ", ")
        return open.map {
            TaskEntity.make($0, projects: store.projects, labels: store.labels, today: today)
        }
    }
}
