import Core
import EventKit
import Foundation

/// DEBUG-only. The simulator has no way to tap, so `PROCRASTIMATE_DEMO` seeds place and event tasks through the store,
/// adds calendar events through EventKit, and opens the screen to screenshot. Release builds omit it.
///
/// Space-separated words: `seed`, `browse`, `details:<task title>`, `sheet:location`, `sheet:event`, and
/// `query:<words with + for spaces>` for the location search.
enum PlacesDemo {
    static var words: [String] {
        #if DEBUG
        ProcessInfo.processInfo.environment["PROCRASTIMATE_DEMO"]?.split(separator: " ").map(String.init) ?? []
        #else
        []
        #endif
    }

    static func has(_ word: String) -> Bool { words.contains(word) }

    static func value(_ key: String) -> String? {
        words.first { $0.hasPrefix("\(key):") }.map { String($0.dropFirst(key.count + 1)).replacingOccurrences(of: "+", with: " ") }
    }

    @MainActor
    static func run(store: Store, calendar: CalendarSync, navigator: Navigator, clock: AppClock) async {
        #if DEBUG
        guard !words.isEmpty else { return }
        if has("seed") { await seed(store: store, calendar: calendar, clock: clock) }
        if has("browse") { navigator.tab = .browse }
        if let title = value("details"), let task = store.tasks.first(where: { $0.title == title }) {
            navigator.sheet = .details(taskID: task.id)
        }
        #endif
    }

    #if DEBUG
    @MainActor
    private static func seed(store: Store, calendar: CalendarSync, clock: AppClock) async {
        await calendar.requestAccess()
        let eventStore = calendar.eventStore
        if calendar.granted, !calendar.upcomingEvents().contains(where: { $0.title == "Standup" }), let target = eventStore.defaultCalendarForNewEvents {
            let today = Dates.fromDateKey(clock.today, in: clock.timeZone)
            let standup = EKEvent(eventStore: eventStore)
            standup.title = "Standup"
            standup.startDate = today.addingTimeInterval(10 * 3600 + 86400)
            standup.endDate = standup.startDate.addingTimeInterval(1800)
            standup.recurrenceRules = [EKRecurrenceRule(recurrenceWith: .daily, interval: 1, end: nil)]
            standup.calendar = target
            let dentist = EKEvent(eventStore: eventStore)
            dentist.title = "Dentist"
            dentist.startDate = today.addingTimeInterval(2 * 86400 + 15 * 3600)
            dentist.endDate = dentist.startDate.addingTimeInterval(3600)
            dentist.calendar = target
            do {
                try eventStore.save(standup, span: .futureEvents)
                try eventStore.save(dentist, span: .thisEvent)
            } catch {
                print("PlacesDemo could not save events: \(error)")
            }
        }
        seedEventTasks(store: store, calendar: calendar)
        guard !store.tasks.contains(where: { $0.title == "Buy oat milk" }) else { return }
        let milk = store.addTask(NewTask(title: "Buy oat milk"))
        store.updateTask(milk.id, TaskPatch(location: .some(TaskLocation(
            name: "Whole Foods Market", address: "20955 Stevens Creek Blvd, Cupertino",
            latitude: 37.3236, longitude: -122.0397, radius: 150, trigger: .arrive
        ))))
        let coffee = store.addTask(NewTask(title: "Try the seasonal blend"))
        store.updateTask(coffee.id, TaskPatch(location: .some(TaskLocation(
            name: "Philz Coffee", address: "20686 Stevens Creek Blvd, Cupertino",
            latitude: 37.3229, longitude: -122.0322, radius: 150, trigger: .during
        ))))
        let beans = store.addTask(NewTask(title: "Ask about decaf beans"))
        store.updateTask(beans.id, TaskPatch(location: .some(TaskLocation(
            name: "Philz Coffee", address: "20686 Stevens Creek Blvd, Cupertino",
            latitude: 37.3229, longitude: -122.0322, radius: 150, trigger: .during
        ))))
    }

    @MainActor
    private static func seedEventTasks(store: Store, calendar: CalendarSync) {
        guard !store.tasks.contains(where: { $0.event != nil }) else { return }
        let upcoming = calendar.upcomingEvents()
        if let standup = upcoming.first(where: { $0.title == "Standup" }) {
            let notes = store.addTask(NewTask(title: "Post standup notes"))
            store.updateTask(notes.id, TaskPatch(
                reminders: [.before(minutes: 10)],
                event: .some(calendar.taskEvent(standup, edge: .after, minutes: 15, onlyThis: false, upcoming: upcoming))
            ))
        }
        if let dentist = upcoming.first(where: { $0.title == "Dentist" }) {
            let floss = store.addTask(NewTask(title: "Floss first"))
            store.updateTask(floss.id, TaskPatch(
                event: .some(calendar.taskEvent(dentist, edge: .before, minutes: 60, onlyThis: false, upcoming: upcoming))
            ))
        }
    }
    #endif
}
