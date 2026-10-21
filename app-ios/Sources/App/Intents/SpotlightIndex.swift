import AppIntents
import Core
import CoreSpotlight

/// Keeps Spotlight in step with open tasks. Completed and deleted tasks are removed, and a burst of edits is one index,
/// built after the debounce from what the store holds then, and sent as the entities that changed since the last one.
@MainActor
enum SpotlightIndex {
    private static var pending: Task<Void, Never>?
    private static var indexed: [String: TaskEntity]?

    /// Indexes the store's open tasks. `router` receives the titles the UI test reads back.
    static func schedule(_ session: IntentSession) {
        pending?.cancel()
        pending = Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            let entities = listed(in: session.store, today: session.clock.today, router: session.router)
            let next = Dictionary(uniqueKeysWithValues: entities.map { ($0.id, $0) })
            // The snapshot advances only once Spotlight took the update; a failed pass is retried whole next time.
            guard let previous = indexed else {
                if (try? await replaceAll(entities)) != nil { indexed = next }
                return
            }
            let changed = entities.filter { previous[$0.id] != $0 }
            let gone = previous.keys.filter { next[$0] == nil }
            guard !changed.isEmpty || !gone.isEmpty else { return }
            if (try? await replace(changed, removing: gone)) != nil { indexed = next }
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

    private static func listed(in store: Store, today: DateKey, router: IntentRouter) -> [TaskEntity] {
        let open = IntentRules.indexedTasks(store.openTasks)
        router.spotlight = open.map(\.title).sorted().joined(separator: ", ")
        let projects = store.snapshot.projects
        return open.map { TaskEntity.make($0, projects: projects, labels: store.labels, today: today) }
    }
}
