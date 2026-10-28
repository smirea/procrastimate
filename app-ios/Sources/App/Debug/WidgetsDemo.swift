import Core
import Foundation

/// DEBUG-only. `PROCRASTIMATE_DEMO=widgets` seeds overdue, enough of today's to overflow a large widget, tomorrow's, and project tasks around the real
/// clock's today, and completes one, so the home and lock screen widgets have something to show in the simulator.
/// The widget extension reads the real clock, so the seed is relative to it. Release builds omit it.
enum WidgetsDemo {
    @MainActor
    static func run(store: Store, clock: AppClock) {
        #if DEBUG
        guard PlacesDemo.has("widgets"), !store.tasks.contains(where: { $0.title == "Renew passport" }) else { return }
        let today = clock.today
        let home = store.projects.first { $0.name == "Home" } ?? store.addProject("Home")
        let seeds: [NewTask] = [
            NewTask(title: "Renew passport", due: Due(date: Dates.addDays(today, -1)), priority: .p1),
            NewTask(title: "Call the plumber", projectId: home.id, due: Due(date: today, time: "16:30"), priority: .p2),
            NewTask(title: "Buy oat milk", due: Due(date: today)),
            NewTask(title: "Water the plants", projectId: home.id, due: Due(date: today), priority: .p3),
            NewTask(title: "Book dentist", due: Due(date: today)),
            NewTask(title: "Look into [Google Maps](https://maps.google.com) offline areas", due: Due(date: today)),
            NewTask(title: "Pick up dry cleaning", due: Due(date: today)),
            NewTask(title: "Reply to Anna", due: Due(date: today), priority: .p3),
            NewTask(title: "Pay the electricity bill", due: Due(date: today)),
            NewTask(title: "Stretch for ten minutes", due: Due(date: today)),
            NewTask(title: "Send invoice", due: Due(date: Dates.addDays(today, 1)), priority: .p2),
            NewTask(title: "Fix the fence", projectId: home.id),
        ]
        for seed in seeds { store.addTask(seed) }
        if let done = store.addTask(NewTask(title: "Morning run", due: Due(date: today))) {
            _ = store.completeTask(done.id)
        }
        #endif
    }
}
