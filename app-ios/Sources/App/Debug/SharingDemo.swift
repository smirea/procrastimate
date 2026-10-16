import Core
import Foundation

/// DEBUG-only. `PROCRASTIMATE_DEMO=sharing` seeds a space Ann Lee shared, through the same response a sync applies,
/// with two tasks Claude and Ann completed, plus an own project to share, so the sharing screens can be driven without a second account. Release builds omit
/// it.
enum SharingDemo {
    @MainActor
    static func run(store: Store) {
        #if DEBUG
        guard PlacesDemo.has("sharing"), store.snapshot.spaces["ann"] == nil else { return }
        let ann = Person(id: "ann", name: "Ann Lee", kind: .human)
        let claude = Person(id: "claude", name: "Claude", kind: .ai, ownerId: "ann")
        store.setSpaces([API.Space(id: ann.id, owner: ann)])
        store.rememberPeople([claude])
        let shared = API.SyncSnapshot(
            tasks: [
                TaskItem(id: "fence", title: "Fix the fence gate", projectId: "garden", createdAt: 1, createdBy: "ann"),
                TaskItem(
                    id: "tulips", title: "Plant the tulip bulbs", notes: "Along the south fence", projectId: "garden",
                    createdAt: 2, createdBy: "ann"
                ),
                TaskItem(id: "hose", title: "Buy a new hose", projectId: "garden", createdAt: 3, createdBy: "claude"),
                TaskItem(id: "vet", title: "Book the vet for Milo", createdAt: 4, createdBy: "ann"),
                TaskItem(
                    id: "rake", title: "Rake the leaves", projectId: "garden", createdAt: 5, completedAt: 1_791_903_600_000,
                    createdBy: "ann", completedBy: "claude", lastCompletedAt: 1_791_903_600_000
                ),
                TaskItem(
                    id: "seeds", title: "Order seeds", projectId: "garden", createdAt: 6, completedAt: 1_791_968_400_000,
                    createdBy: "ann", completedBy: "ann", lastCompletedAt: 1_791_968_400_000
                ),
            ],
            projects: [Project(id: "garden", name: "Garden", createdAt: 1)],
            labels: [],
            settings: API.Settings()
        )
        _ = store.takeSyncResponse(
            .snapshot(.init(snapshot: shared, cursor: 1, hlc: "1:0:server", epoch: 0, scope: "demo", readOnly: ["fence"], targets: [
                API.ShareTarget(kind: .project, id: "garden"), API.ShareTarget(kind: .task, id: "vet"),
            ])),
            space: ann.id
        )
        if !store.projects.contains(where: { $0.name == "Trip to Lisbon" }) {
            let trip = store.addProject("Trip to Lisbon")
            store.addTask(NewTask(title: "Book the flights", projectId: trip.id))
            store.addTask(NewTask(title: "Find a place near Alfama", projectId: trip.id))
        }
        #endif
    }
}
