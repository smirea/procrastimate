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

    static func id(_ event: EKEvent) -> String {
        event.calendarItemExternalIdentifier ?? event.eventIdentifier ?? ""
    }

    static func occurrence(_ event: EKEvent) -> EventOccurrence {
        EventOccurrence(start: event.startDate.epochMilliseconds, end: event.endDate.epochMilliseconds)
    }

    private static func matches(_ event: EKEvent, _ id: String) -> Bool {
        event.calendarItemExternalIdentifier == id || event.eventIdentifier == id
    }

    /// What picking `event` saves. A repeating event follows its series unless pinned to this one occurrence, which is
    /// remembered by its original date so a later move still finds it.
    func taskEvent(_ event: EKEvent, edge: EventEdge, minutes: Int, onlyThis: Bool, upcoming: [EKEvent]) -> TaskEvent {
        let id = Self.id(event)
        let repeating = event.hasRecurrenceRules
        let series = repeating && !onlyThis
        let listed = upcoming.filter { Self.matches($0, id) }.prefix(Self.seriesLimit).map(Self.occurrence)
        return TaskEvent(
            id: id,
            title: event.title ?? "Event",
            allDay: event.isAllDay,
            series: series,
            occurrenceDate: repeating && onlyThis ? event.occurrenceDate.epochMilliseconds : nil,
            edge: edge,
            minutes: edge == .before || edge == .after ? minutes : 0,
            occurrences: series && !listed.isEmpty ? Array(listed) : [Self.occurrence(event)]
        )
    }

    /// Rewrites each open event task whose event changed in the calendar. It never asks for access, and a task whose
    /// event is gone keeps what it had.
    func sync() {
        access = EKEventStore.authorizationStatus(for: .event)
        guard granted else { return }
        let tasks = store.tasks.filter { $0.completedAt == nil && $0.event != nil }
        guard !tasks.isEmpty else { return }
        let upcoming = upcomingEvents()
        for task in tasks {
            guard let event = task.event, let next = refreshed(event, upcoming), next != event else { continue }
            store.updateTask(task.id, TaskPatch(event: .some(next)))
        }
    }

    private func refreshed(_ event: TaskEvent, _ upcoming: [EKEvent]) -> TaskEvent? {
        let found: [EKEvent]
        if event.series {
            found = upcoming.filter { Self.matches($0, event.id) }
        } else if let pinned = event.occurrenceDate {
            found = pinnedOccurrence(event.id, pinned).map { [$0] } ?? []
        } else {
            found = plainEvent(event.id).map { [$0] } ?? []
        }
        guard let first = found.first else { return nil }
        var next = event
        next.title = first.title ?? event.title
        next.allDay = first.isAllDay
        let occurrences = found.map(Self.occurrence)
        next.occurrences = event.series
            ? Array(Self.remaining(occurrences, after: event.occurrences).prefix(Self.seriesLimit))
            : occurrences
        return next
    }

    /// Completing a series task drops the occurrence it was on, which the calendar still lists from the start of today.
    /// The stored first occurrence is the one the task is on, so the listing resumes at the occurrence nearest it:
    /// series occurrences are a period apart, so that is the same occurrence even after it moved.
    static func remaining(_ found: [EventOccurrence], after stored: [EventOccurrence]) -> [EventOccurrence] {
        guard let current = stored.first,
              let index = found.indices.min(by: { abs(found[$0].start - current.start) < abs(found[$1].start - current.start) })
        else { return found }
        return Array(found[index...])
    }

    private func pinnedOccurrence(_ id: String, _ occurrenceDate: Int) -> EKEvent? {
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
