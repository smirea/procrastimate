import Core
import EventKit
import Foundation
import Observation

/// The calendar half of event tasks: the events the picker lists, the `TaskEvent` a pick saves, and the refresh that
/// keeps every open event task on its event's current times, so a moved meeting moves its reminders on every client.
@MainActor @Observable
final class CalendarSync {
    static let window: TimeInterval = 60 * 86400
    static let seriesLimit = 10

    private(set) var access = EKEventStore.authorizationStatus(for: .event)

    @ObservationIgnored let eventStore = EKEventStore()
    @ObservationIgnored private let store: Store
    @ObservationIgnored private let clock: AppClock

    init(store: Store, clock: AppClock) {
        self.store = store
        self.clock = clock
    }

    var granted: Bool { access == .fullAccess }

    func requestAccess() async {
        guard access == .notDetermined || access == .writeOnly else { return }
        _ = try? await eventStore.requestFullAccessToEvents()
        access = EKEventStore.authorizationStatus(for: .event)
    }

    private var startOfToday: Date { Dates.fromDateKey(clock.today, in: clock.timeZone) }

    /// Every event from the start of today through the next 60 days, each occurrence of a repeating one on its own.
    func upcomingEvents() -> [EKEvent] {
        guard granted else { return [] }
        return events(from: startOfToday, to: startOfToday.addingTimeInterval(Self.window))
    }

    private func events(from start: Date, to end: Date) -> [EKEvent] {
        eventStore.events(matching: eventStore.predicateForEvents(withStart: start, end: end, calendars: nil))
            .sorted { $0.startDate < $1.startDate }
    }

    /// A moved occurrence of a repeating event is detached, and its identifiers gain a `/RID=<date>` suffix, so the
    /// series is named by what comes before it.
    static func id(_ event: EKEvent) -> String {
        seriesID(event.calendarItemExternalIdentifier ?? event.eventIdentifier ?? "")
    }

    /// A moved occurrence reports no recurrence rules of its own, yet still belongs to its series.
    static func repeats(_ event: EKEvent) -> Bool {
        event.hasRecurrenceRules || event.isDetached
    }

    private static func seriesID(_ id: String) -> String {
        id.range(of: "/RID=").map { String(id[..<$0.lowerBound]) } ?? id
    }

    static func occurrence(_ event: EKEvent) -> EventOccurrence {
        EventOccurrence(
            start: event.startDate.epochMilliseconds,
            end: event.endDate.epochMilliseconds,
            original: event.occurrenceDate.epochMilliseconds
        )
    }

    private static func matches(_ event: EKEvent, _ id: String) -> Bool {
        [event.calendarItemExternalIdentifier, event.eventIdentifier].contains { $0.map(seriesID) == id }
    }

    /// What picking `event` saves. A repeating event follows its series unless pinned to this one occurrence, which its
    /// original date finds again after a move.
    func taskEvent(_ event: EKEvent, timing: EventTiming, onlyThis: Bool, upcoming: [EKEvent]) -> TaskEvent {
        let id = Self.id(event)
        let repeating = Self.repeats(event)
        let series = repeating && !onlyThis
        let listed = upcoming.filter { Self.matches($0, id) }.prefix(Self.seriesLimit).map(Self.occurrence)
        return TaskEvent(
            id: id,
            title: event.title ?? "Event",
            allDay: event.isAllDay,
            series: series,
            edge: timing.edge,
            minutes: timing.minutes,
            occurrences: series && !listed.isEmpty ? Array(listed) : [Self.occurrence(event)]
        )
    }

    /// Rewrites each open event task whose event changed in the calendar. It never asks for access, and a task whose
    /// event is gone keeps what it had.
    func sync() {
        access = EKEventStore.authorizationStatus(for: .event)
        guard granted else { return }
        let tasks = store.openTasks.filter { $0.event != nil }
        guard !tasks.isEmpty else { return }
        let upcoming = upcomingEvents()
        for task in tasks {
            guard let event = task.event, let next = refreshed(event, upcoming), next != event else { continue }
            store.updateTask(task.id, TaskPatch(event: .some(next)))
        }
    }

    /// A series resumes at the occurrence the task is on, so the ones completing dropped stay dropped. Any other task
    /// finds its one occurrence by its original date, or a plain event by its id after it moves.
    private func refreshed(_ event: TaskEvent, _ upcoming: [EKEvent]) -> TaskEvent? {
        let current = event.occurrences[0].original
        let found: [EKEvent]
        let listed = { upcoming.first { Self.matches($0, event.id) && $0.occurrenceDate.epochMilliseconds == current } }
        if event.series {
            found = upcoming.filter { Self.matches($0, event.id) && $0.occurrenceDate.epochMilliseconds >= current }
        } else if let occurrence = listed() ?? occurrence(event.id, current) {
            // The upcoming window already read once answers for most tasks; the wider per-task query is the fallback.
            found = [occurrence]
        } else {
            found = plainEvent(event.id).flatMap { Self.repeats($0) ? nil : [$0] } ?? []
        }
        guard let first = found.first else { return nil }
        var next = event
        next.title = first.title ?? event.title
        next.allDay = first.isAllDay
        next.occurrences = Array(found.prefix(Self.seriesLimit).map(Self.occurrence))
        return next
    }

    private func occurrence(_ id: String, _ occurrenceDate: Int) -> EKEvent? {
        let original = Date(epochMilliseconds: occurrenceDate)
        let start = min(startOfToday, original).addingTimeInterval(-7 * 86400)
        let end = max(startOfToday, original).addingTimeInterval(Self.window)
        return events(from: start, to: end).first {
            Self.matches($0, id) && $0.occurrenceDate.epochMilliseconds == occurrenceDate
        }
    }

    private func plainEvent(_ id: String) -> EKEvent? {
        eventStore.calendarItems(withExternalIdentifier: id).lazy.compactMap { $0 as? EKEvent }.first
            ?? eventStore.event(withIdentifier: id)
    }
}
