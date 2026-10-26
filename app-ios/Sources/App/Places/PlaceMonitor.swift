import ActivityKit
import BackgroundTasks
import Core
import CoreLocation
import Foundation
import Observation
import OSLog
@preconcurrency import UserNotifications

/// Watches the places on open tasks with `CLMonitor` region conditions, which iOS evaluates from cell and Wi-Fi changes
/// without keeping GPS on, and relaunches the app for. `Arrive` and `Leave` notify on the crossing; `During` keeps a
/// Live Activity of the place's tasks up while Stefan is inside.
@MainActor @Observable
final class PlaceMonitor: NSObject {
    nonisolated static let refreshTaskID = "com.stefan.procrastimate.places"
    nonisolated static let notificationPrefix = "place:"
    /// iOS monitors at most 20 regions per app.
    static let limit = 20
    private static let statesKey = "procrastimate-place-states"
    private static let log = Logger(subsystem: "com.stefan.procrastimate", category: "places")

    /// Why an armed place is not being watched, keyed by condition id.
    private(set) var unwatched: [String: Unwatched] = [:]

    enum Unwatched {
        /// iOS reported the condition `.unmonitored`: too large for the device, past its region limit, or monitoring
        /// is unavailable, as on the simulator.
        case refused
        /// The place lost to the 20 armed soonest.
        case overLimit
    }

    func unwatched(_ location: TaskLocation) -> Unwatched? {
        unwatched[Self.conditionID(location)]
    }

    @ObservationIgnored private let store: Store
    @ObservationIgnored private let clock: AppClock
    @ObservationIgnored private let manager = CLLocationManager()
    @ObservationIgnored private var monitor: CLMonitor?
    /// Since iOS 18 an app with Always authorization gets `CLMonitor` events while not in use only while it holds a
    /// session requiring Always. Without one, crossings queued until Stefan opened the app.
    @ObservationIgnored private var session: CLServiceSession?
    @ObservationIgnored private var pending: Task<Void, Never>?
    @ObservationIgnored private var running: Task<Void, Never>?
    /// The last state each condition reported, kept across launches, so a crossing is a change from a known state and
    /// the first report after a condition is added never counts as one.
    @ObservationIgnored private var states: [String: Bool]

    init(store: Store, clock: AppClock) {
        self.store = store
        self.clock = clock
        states = UserDefaults.standard.dictionary(forKey: Self.statesKey) as? [String: Bool] ?? [:]
        super.init()
        manager.delegate = self
    }

    /// Opens the monitor and listens before anything else, since a relaunch for a crossing delivers it right away.
    func start() async {
        holdSession()
        let monitor = await CLMonitor("ProcrastimatePlaces")
        self.monitor = monitor
        Task {
            do {
                for try await event in await monitor.events { await handle(event) }
            } catch {
                ErrorReport.log("Place monitoring stopped", error: error)
            }
        }
        await sync()
    }

    /// Asked the first time a task gets a place. Always is what lets iOS wake the app at a crossing; requesting it
    /// first shows When In Use, and iOS offers the upgrade later on its own.
    func requestPermission() {
        switch manager.authorizationStatus {
        case .notDetermined, .authorizedWhenInUse: manager.requestAlwaysAuthorization()
        default: break
        }
    }

    /// Taken only once Always is granted, since a session requiring Always asks for it and nothing may ask at launch.
    /// It must be retaken right at launch, including a background relaunch for a crossing, which `start` does.
    private func holdSession() {
        guard session == nil, manager.authorizationStatus == .authorizedAlways else { return }
        session = CLServiceSession(authorization: .always)
    }

    /// The largest circle this device can watch, or nil where region monitoring is unavailable, as on the simulator.
    var maxRadius: Double? {
        let max = manager.maximumRegionMonitoringDistance
        return max > 0 ? max : nil
    }

    var nearby: CLLocation? {
        switch manager.authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse: manager.location
        default: nil
        }
    }

    func tasksChanged() {
        pending?.cancel()
        pending = Task {
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            await sync()
        }
    }

    /// Arms the soonest 20 places, drops the rest, and brings the Live Activities in line with where Stefan is.
    func sync() async {
        let previous = running
        let task = Task {
            await previous?.value
            await apply()
        }
        running = task
        await task.value
    }

    private func apply() async {
        guard let monitor else { return }
        let now = clock.now
        let plan = Self.plan(store.openTasks, now: now, today: clock.today, in: clock.timeZone)
        let wanted = Dictionary(plan.armed.map { (Self.conditionID($0), $0) }) { a, _ in a }
        let existing = Set(await monitor.identifiers)
        for id in existing where wanted[id] == nil {
            await monitor.remove(id)
            states[id] = nil
        }
        for (id, location) in wanted where !existing.contains(id) {
            let center = CLLocationCoordinate2D(latitude: location.latitude, longitude: location.longitude)
            await monitor.add(CLMonitor.CircularGeographicCondition(center: center, radius: location.radius), identifier: id)
        }
        var unwatched: [String: Unwatched] = [:]
        for id in wanted.keys where await monitor.record(for: id)?.lastEvent.state == .unmonitored {
            unwatched[id] = .refused
        }
        for location in plan.overLimit {
            unwatched[Self.conditionID(location)] = .overLimit
        }
        for (id, reason) in unwatched where self.unwatched[id] != reason { Self.logUnwatched(id, reason) }
        self.unwatched = unwatched
        saveStates()
        await reconcileActivities(entered: [])
        if let next = plan.nextArm {
            let request = BGAppRefreshTaskRequest(identifier: Self.refreshTaskID)
            request.earliestBeginDate = next
            try? await BGTaskScheduler.shared.submitTaskRequest(request)
        }
    }

    struct Plan {
        var armed: [TaskLocation]
        var overLimit: [TaskLocation]
        var nextArm: Date?
    }

    /// A place with a due date or reminders matters from the start of its day or its first reminder, whichever comes
    /// first, so it is only watched from then. Without either it is always watched.
    static func armingMoment(_ task: TaskItem, today: DateKey, in zone: TimeZone) -> Date? {
        let due = Triggers.scheduledDue(task, today, in: zone)
        var moments = task.reminders.compactMap { Notifications.reminderFiresAt($0, due, in: zone) }
        if let due { moments.append(Dates.fromDateKey(due.date, in: zone)) }
        return moments.min()
    }

    static func isArmed(_ task: TaskItem, now: Date, today: DateKey, in zone: TimeZone) -> Bool {
        (armingMoment(task, today: today, in: zone) ?? .distantPast) <= now
    }

    /// One condition per place, armed from its first armed task, so many tasks at one place take one of the 20 slots.
    static func plan(_ tasks: [TaskItem], now: Date, today: DateKey, in zone: TimeZone) -> Plan {
        var armed: [String: (at: Date, location: TaskLocation)] = [:]
        var nextArm: Date?
        for task in tasks where task.completedAt == nil {
            guard let location = task.location else { continue }
            let at = armingMoment(task, today: today, in: zone) ?? .distantPast
            guard at <= now else {
                nextArm = min(nextArm ?? at, at)
                continue
            }
            let id = conditionID(location)
            if at < armed[id]?.at ?? .distantFuture { armed[id] = (at, location) }
        }
        let soonest = armed.values.sorted { $0.at == $1.at ? conditionID($0.location) < conditionID($1.location) : $0.at < $1.at }
        return Plan(armed: soonest.prefix(limit).map(\.location), overLimit: soonest.dropFirst(limit).map(\.location), nextArm: nextArm)
    }

    /// Keyed by spot and radius, so tasks at one place share a condition and moving a place replaces it.
    static func conditionID(_ location: TaskLocation) -> String {
        "\(Triggers.placeKey(location))|\(Int(location.radius))"
    }

    private static func logUnwatched(_ id: String, _ reason: Unwatched) {
        switch reason {
        case .refused: log.error("iOS refused to monitor place \(id, privacy: .private)")
        case .overLimit: log.error("Not watching place \(id, privacy: .private): \(limit) sooner places are armed")
        }
    }

    private func saveStates() {
        UserDefaults.standard.set(states, forKey: Self.statesKey)
    }

    private func handle(_ event: CLMonitor.Event) async {
        let id = event.identifier
        let inside: Bool
        switch event.state {
        case .satisfied: inside = true
        case .unsatisfied: inside = false
        case .unmonitored:
            if unwatched[id] != .refused { Self.logUnwatched(id, .refused) }
            unwatched[id] = .refused
            states[id] = nil
            saveStates()
            await reconcileActivities(entered: [])
            return
        default: return
        }
        if unwatched[id] == .refused { unwatched[id] = nil }
        let before = states[id]
        states[id] = inside
        saveStates()
        let now = clock.now
        let here = store.openTasks.filter { task in
            guard task.completedAt == nil, let location = task.location else { return false }
            return Self.conditionID(location) == id && Self.isArmed(task, now: now, today: clock.today, in: clock.timeZone)
        }
        let crossed = here.filter { task in
            switch task.location?.trigger {
            case .arrive: before == false && inside
            case .leave: before == true && !inside
            case .during, nil: false
            }
        }
        if let location = crossed.first?.location { notify(crossed, location) }
        if here.contains(where: { $0.location?.trigger == .during }) {
            let entered = before == false && inside ? here.compactMap(\.location).map(Triggers.placeKey) : []
            await reconcileActivities(entered: Set(entered))
        }
    }

    /// One notification for every task a crossing reaches, so arriving at a place with four tasks shows one.
    private func notify(_ tasks: [TaskItem], _ location: TaskLocation) {
        let item = Notifications.placeNotification(tasks, location, at: clock.now)
        let content = UNMutableNotificationContent()
        content.title = item.title
        content.body = item.body
        content.sound = .default
        content.interruptionLevel = .timeSensitive
        content.threadIdentifier = Triggers.placeKey(location)
        content.userInfo = item.opens.userInfo
        let id = "\(Self.notificationPrefix)\(Triggers.placeKey(location)):\(clock.now.epochMilliseconds)"
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: id, content: content, trigger: nil))
    }

    /// One activity per place with an open `During` task whose condition last reported inside. ActivityKit starts an
    /// activity only while the app is in the foreground, so a crossing in the background notifies instead, and the
    /// next foreground sync starts it if Stefan is still there.
    private func reconcileActivities(entered: Set<String>) async {
        var wanted: [String: (name: String, titles: [String], first: TaskItem)] = [:]
        for task in store.openTasks {
            guard let location = task.location, location.trigger == .during,
                  states[Self.conditionID(location)] == true else { continue }
            let key = Triggers.placeKey(location)
            wanted[key, default: (location.name, [], task)].titles.append(task.title)
        }
        for activity in Activity<PlaceActivityAttributes>.activities {
            let key = activity.attributes.key
            if let place = wanted.removeValue(forKey: key) {
                if activity.content.state.titles != place.titles {
                    await activity.update(.init(state: .init(titles: place.titles), staleDate: nil))
                }
            } else {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
        }
        for (key, place) in wanted {
            do {
                _ = try Activity.request(
                    attributes: PlaceActivityAttributes(key: key, placeName: place.name),
                    content: .init(state: .init(titles: place.titles), staleDate: nil)
                )
            } catch {
                if entered.contains(key), let location = place.first.location { notify([place.first], location) }
            }
        }
    }
}

extension PlaceMonitor: CLLocationManagerDelegate {
    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        Task { @MainActor in
            self.holdSession()
            await self.sync()
        }
    }
}
