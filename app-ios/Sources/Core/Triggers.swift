import Foundation

public typealias TaskLocation = API.TaskLocation
public typealias LocationTrigger = API.LocationTrigger
public typealias TaskEvent = API.TaskEvent
public typealias EventEdge = API.EventEdge
public typealias EventOccurrence = API.EventOccurrence

/// Tasks that hang off a place or a calendar event, from `shared/triggers.ts`.
public enum Triggers {
    public typealias PlaceGroup = API.PlaceGroup
    public typealias EventGroup = API.EventGroup
    public typealias EventLabel = API.EventLabel

    /// The moment the task's edge names on one occurrence, in epoch milliseconds.
    public static func eventAnchor(_ event: TaskEvent, _ occurrence: EventOccurrence) -> Int {
        switch event.edge {
        case .before: occurrence.start - event.minutes * 60_000
        case .start, .during: occurrence.start
        case .after: occurrence.end + event.minutes * 60_000
        }
    }

    /// A single event keeps its one occurrence, so it goes overdue. A series skips occurrences whose day is over.
    public static func currentOccurrence(_ event: TaskEvent, _ today: DateKey, in zone: TimeZone) -> EventOccurrence {
        guard event.series else { return event.occurrences[0] }
        return event.occurrences.first {
            Dates.toDateKey(Date(epochMilliseconds: eventAnchor(event, $0)), in: zone) >= today
        } ?? event.occurrences[event.occurrences.count - 1]
    }

    /// An occurrence's moment as a due date, without a time for an all-day event.
    public static func occurrenceDue(_ event: TaskEvent, _ occurrence: EventOccurrence, in zone: TimeZone) -> Due {
        let at = eventAnchor(event, occurrence)
        let date = Dates.toDateKey(Date(epochMilliseconds: at), in: zone)
        return Due(date: date, time: event.allDay ? nil : wallTime(at, in: zone))
    }

    static func wallTime(_ epochMilliseconds: Int, in zone: TimeZone) -> TimeOfDay {
        let at = Date(epochMilliseconds: epochMilliseconds)
        let local = Int((at.timeIntervalSince1970 + Double(zone.secondsFromGMT(for: at))).rounded(.down))
        let minutes = ((local % 86400 + 86400) % 86400) / 60
        return Dates.toTimeOfDay(hours: minutes / 60, minutes: minutes % 60)
    }

    /// The day and time a task sits on in lists. A repeat with a place skips missed occurrences instead of going overdue.
    public static func scheduledDue(_ task: TaskItem, _ today: DateKey, in zone: TimeZone) -> Due? {
        if let event = task.event { return occurrenceDue(event, currentOccurrence(event, today, in: zone), in: zone) }
        guard task.location != nil, let recurrence = task.recurrence, let due = task.due, due.date < today else {
            return task.due
        }
        var date = due.date
        while date < today { date = Dates.stepRecurrence(date, recurrence) }
        return Due(date: date, time: due.time)
    }

    /// When a task notifies, each moment once. An event notifies at each listed moment unless it lasts all day, and a
    /// due time at a place never notifies on its own.
    public static func taskNotificationTimes(_ task: TaskItem, _ today: DateKey, in zone: TimeZone) -> [Date] {
        guard task.event != nil || task.location != nil else {
            return Notifications.notificationTimes(task.due, task.reminders, in: zone)
        }
        var moments: [Date?] = []
        if let event = task.event {
            for occurrence in event.series ? event.occurrences : Array(event.occurrences.prefix(1)) {
                let due = occurrenceDue(event, occurrence, in: zone)
                if !event.allDay { moments.append(Date(epochMilliseconds: eventAnchor(event, occurrence))) }
                moments += task.reminders.map { Notifications.reminderFiresAt($0, due, in: zone) }
            }
        } else {
            let due = scheduledDue(task, today, in: zone)
            moments += task.reminders.map { Notifications.reminderFiresAt($0, due, in: zone) }
        }
        var seen = Set<Int>()
        return moments.compactMap { $0 }.filter { seen.insert($0.epochMilliseconds).inserted }.sorted()
    }

    public static func formatEvent(_ event: TaskEvent) -> String {
        switch event.edge {
        case .before:
            event.minutes > 0
                ? "\(Format.formatMinutes(event.minutes)) before \(event.title)" : "When \(event.title) starts"
        case .start: "When \(event.title) starts"
        case .during: "During \(event.title)"
        case .after:
            event.minutes > 0 ? "\(Format.formatMinutes(event.minutes)) after \(event.title)" : "After \(event.title)"
        }
    }

    /// A row's event line in parts: `4:15pm`, `15m after`, `Standup`. `when` is the task's moment on its occurrence,
    /// worded like any due date but without the day when it is today.
    public static func eventLabel(_ event: TaskEvent, _ today: DateKey, in zone: TimeZone) -> EventLabel {
        let lead = switch event.edge {
        case .before: event.minutes > 0 ? "\(Format.formatMinutes(event.minutes)) before" : "Start of"
        case .start: "Start of"
        case .during: "During"
        case .after: event.minutes > 0 ? "\(Format.formatMinutes(event.minutes)) after" : "After"
        }
        let due = occurrenceDue(event, currentOccurrence(event, today, in: zone), in: zone)
        let when = due.date != today ? Format.formatDue(due, today) : due.time.map(Format.formatTime)
        return EventLabel(lead: lead, title: event.title, when: when)
    }

    public static func formatLocation(_ location: TaskLocation) -> String {
        switch location.trigger {
        case .arrive: "Arriving at \(location.name)"
        case .leave: "Leaving \(location.name)"
        case .during: "While at \(location.name)"
        }
    }

    /// Tasks at the same spot share a place, to about 11 meters.
    public static func placeKey(_ location: TaskLocation) -> String {
        "\(fixed4(location.latitude)),\(fixed4(location.longitude))"
    }

    /// Meters watched around a picked place, fitted to its Apple Maps extent so a city fires at its edge, not at a
    /// pin in its center. Maps frames every shop, address, or pin in about a kilometer, so an extent whose shorter
    /// side is at most 1.5 km is a spot and keeps 150 m. A park, neighborhood, city, or region gets half its shorter
    /// side, the circle that fits inside it, capped at 100 km because a crossing that far out says nothing, and at
    /// `deviceMax`, the largest circle the device can watch, because a larger one is never monitored.
    public static func placeRadius(
        latitudeDelta: Double, longitudeDelta: Double, latitude: Double, deviceMax: Double? = nil
    ) -> Double {
        let metersPerDegree = 111_320.0
        let height = latitudeDelta * metersPerDegree
        let width = longitudeDelta * metersPerDegree * cos(latitude * .pi / 180)
        let shorter = min(height, width)
        guard shorter > 1_500 else { return 150 }
        return min((shorter / 2 / 10).rounded() * 10, 100_000, deviceMax ?? .infinity)
    }

    public static func formatRadius(_ meters: Double) -> String {
        let tens = (meters / 10).rounded() * 10
        if tens < 1_000 { return "\(Int(tens)) m" }
        let tenths = (meters / 100).rounded() / 10
        if tenths < 10 { return tenths == tenths.rounded() ? "\(Int(tenths)) km" : "\(tenths) km" }
        return "\(Int((meters / 1_000).rounded())) km"
    }

    public struct RadiusPreset: Hashable, Sendable {
        public let name: String
        public let meters: Double
    }

    public static let radiusPresets = [
        RadiusPreset(name: "Block", meters: 150),
        RadiusPreset(name: "Neighborhood", meters: 1_000),
        RadiusPreset(name: "City", meters: 10_000),
    ]

    /// The presets for a place's radius editor, led by `Fitted`, the size fitted from Apple Maps at pick time, while it
    /// is none of the fixed presets and not the radius the place has now, so it only appears once there is a way back.
    public static func radiusPresets(for location: TaskLocation) -> [RadiusPreset] {
        guard let fitted = location.fittedRadius, fitted != location.radius,
              !radiusPresets.contains(where: { $0.meters == fitted })
        else { return radiusPresets }
        return [RadiusPreset(name: "Fitted", meters: fitted)] + radiusPresets
    }

    /// Below about 100 m a phone's cell and Wi-Fi fix can't tell inside from outside, so crossings would flicker.
    public static let minRadius = 100.0

    /// The largest radius the editor offers: 100 km, like a fitted place, or less where the device watches less.
    public static func maxRadius(deviceMax: Double?) -> Double {
        max(minRadius, min(100_000, deviceMax ?? .infinity))
    }

    /// The radius slider runs on a log scale, so its first half spans a block to a neighborhood and its second half
    /// reaches a city, and it snaps to 10 m below a kilometer, 100 m below 10 km, and whole kilometers above.
    public static func radius(atSlider position: Double, max upper: Double) -> Double {
        let raw = minRadius * pow(upper / minRadius, min(1, Swift.max(0, position)))
        let step: Double = raw < 1_000 ? 10 : raw < 10_000 ? 100 : 1_000
        return min(upper, Swift.max(minRadius, (raw / step).rounded() * step))
    }

    public static func sliderPosition(of radius: Double, max upper: Double) -> Double {
        guard upper > minRadius else { return 1 }
        return min(1, Swift.max(0, log(radius / minRadius) / log(upper / minRadius)))
    }

    static func fixed4(_ value: Double) -> String { String(format: "%.4f", locale: Locale(identifier: "en_US_POSIX"), value) }

    static func open(_ tasks: [TaskItem]) -> [TaskItem] {
        tasks.filter { $0.completedAt == nil }.stableSorted { a, b in a.createdAt == b.createdAt ? nil : a.createdAt < b.createdAt }
    }

    public static func placeGroups(_ tasks: [TaskItem]) -> [PlaceGroup] {
        var groups: [PlaceGroup] = []
        for task in open(tasks) {
            guard let location = task.location else { continue }
            let key = placeKey(location)
            if let i = groups.firstIndex(where: { $0.key == key }) {
                groups[i].count += 1
            } else {
                groups.append(PlaceGroup(key: key, name: location.name, count: 1))
            }
        }
        return groups.stableSorted { a, b in
            let order = a.name.compare(b.name, locale: Locale(identifier: "en"))
            if order != .orderedSame { return order == .orderedAscending }
            return a.key == b.key ? nil : a.key < b.key
        }
    }

    public static func eventGroups(_ tasks: [TaskItem], _ today: DateKey, in zone: TimeZone) -> [EventGroup] {
        var groups: [(group: EventGroup, at: Int)] = []
        for task in open(tasks) {
            guard let event = task.event else { continue }
            let at = currentOccurrence(event, today, in: zone).start
            if let i = groups.firstIndex(where: { $0.group.id == event.id }) {
                groups[i].group.count += 1
                groups[i].at = min(groups[i].at, at)
            } else {
                groups.append((EventGroup(id: event.id, title: event.title, count: 1), at))
            }
        }
        return groups.stableSorted { a, b in
            if a.at != b.at { return a.at < b.at }
            return a.group.id == b.group.id ? nil : a.group.id < b.group.id
        }.map(\.group)
    }
}
