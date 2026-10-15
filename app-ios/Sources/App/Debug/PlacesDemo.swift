import Core
import EventKit
import Foundation
import UIKit

/// DEBUG-only. The simulator has no way to tap, so `PROCRASTIMATE_DEMO` seeds place and event tasks through the store,
/// adds calendar events through EventKit, and opens the screen to screenshot. Release builds omit it.
///
/// Space-separated words: `seed`, `move` (shifts the next Standup an hour later, then logs what the task holds),
/// `browse`, `details:<task title>`, `sheet:location`, `sheet:event`, and
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
        if has("move") { await move(store: store, calendar: calendar) }
        if has("browse") { navigator.tab = .browse }
        if has("nodate") { navigator.tab = .noDate }
        if has("search") { navigator.showSearch() }
        if let title = value("details"), let task = store.tasks.first(where: { $0.title == title }) {
            navigator.sheet = .details(taskID: task.id)
        }
        if has("ramble") { navigator.startRambleListening = true }
        if has("quickadd") || has("ramble") { navigator.sheet = .quickAdd(QuickAddDefaults()) }
        if let text = value("type") { await type(text) }
        #endif
    }

    #if DEBUG
    /// Types into the focused field one character at a time through `UIKeyInput`, the path the keyboard takes, then logs
    /// what the field holds.
    @MainActor
    private static func type(_ text: String) async {
        try? await Task.sleep(for: .seconds(1))
        guard let field = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).flatMap(\.windows)
            .lazy.compactMap({ firstResponder(in: $0) }).first else {
            NSLog("PlacesDemo type: no focused field")
            return
        }
        for character in text {
            field.insertText(String(character))
            try? await Task.sleep(for: .milliseconds(25))
        }
        try? await Task.sleep(for: .milliseconds(500))
        let typed = (field as? UITextView)?.text ?? (field as? UITextField)?.text ?? "?"
        NSLog("PlacesDemo typed: %@", typed)
    }

    @MainActor
    private static func firstResponder(in view: UIView) -> (UIView & UIKeyInput)? {
        if view.isFirstResponder, let input = view as? UIView & UIKeyInput { return input }
        return view.subviews.lazy.compactMap { firstResponder(in: $0) }.first
    }
    #endif

    #if DEBUG
    @MainActor
    private static func move(store: Store, calendar: CalendarSync) async {
        guard let standup = calendar.upcomingEvents().first(where: { $0.title == "Standup" }),
              let task = store.tasks.first(where: { $0.event?.title == "Standup" }) else { return }
        NSLog("PlacesDemo before move: %@", "\(task.event!.occurrences.prefix(2))")
        standup.startDate = standup.startDate.addingTimeInterval(3600)
        standup.endDate = standup.endDate.addingTimeInterval(3600)
        try? calendar.eventStore.save(standup, span: .thisEvent)
        try? await Task.sleep(for: .seconds(2))
        NSLog("PlacesDemo after move: %@", "\(store.task(task.id)!.event!.occurrences.prefix(2))")
    }

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
        guard let milk = store.addTask(NewTask(title: "Buy oat milk")) else { return }
        store.updateTask(milk.id, TaskPatch(location: .some(TaskLocation(
            name: "Whole Foods Market", address: "20955 Stevens Creek Blvd, Cupertino",
            latitude: 37.3236, longitude: -122.0397, radius: 150, trigger: .arrive
        ))))
        guard let coffee = store.addTask(NewTask(title: "Try the seasonal blend")) else { return }
        store.updateTask(coffee.id, TaskPatch(location: .some(TaskLocation(
            name: "Philz Coffee", address: "20686 Stevens Creek Blvd, Cupertino",
            latitude: 37.3229, longitude: -122.0322, radius: 150, trigger: .during
        ))))
        guard let beans = store.addTask(NewTask(title: "Ask about decaf beans")) else { return }
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
            guard let notes = store.addTask(NewTask(title: "Post standup notes")) else { return }
            store.updateTask(notes.id, TaskPatch(
                reminders: [.before(minutes: 10)],
                event: .some(calendar.taskEvent(standup, edge: .after, minutes: 15, onlyThis: false, upcoming: upcoming))
            ))
        }
        if let dentist = upcoming.first(where: { $0.title == "Dentist" }) {
            guard let floss = store.addTask(NewTask(title: "Floss first")) else { return }
            store.updateTask(floss.id, TaskPatch(
                event: .some(calendar.taskEvent(dentist, edge: .before, minutes: 60, onlyThis: false, upcoming: upcoming))
            ))
        }
    }
    #endif
}
