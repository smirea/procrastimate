import BackgroundTasks
import Core
import Foundation
import Observation
import SwiftUI
@preconcurrency import UserNotifications

/// Where this device stands with notifications. Each one is a view on the Notifications screen.
enum NotificationStatus: Equatable {
    case checking
    /// Permission not asked yet, or granted and turned off here.
    case off
    case denied
    case on

    /// The short status Browse shows next to Notifications, like the web sidebar.
    var label: String? {
        switch self {
        case .checking: nil
        case .off: "Off"
        case .denied: "Blocked"
        case .on: "On"
        }
    }
}

/// Local notifications: the device schedules the soonest moments of open tasks from `Core`'s notification times, with
/// the same `<taskId>:<epoch ms>` identifiers as the web's push tags, and replaces the schedule after every change.
/// The open app shows reminders as toasts instead of banners.
@MainActor @Observable
final class LocalNotifications: NSObject {
    nonisolated static let refreshTaskID = "com.stefan.procrastimate.refresh"
    nonisolated static let testID = "test"
    private static let enabledKey = "procrastimate-notifications"

    private(set) var status: NotificationStatus = .checking
    /// The requests the device holds, soonest first, as `title@<ISO time>: body` like the web suite's server schedule.
    private(set) var pending: [String] = []

    @ObservationIgnored private let store: Store
    @ObservationIgnored private let toasts: Toasts
    @ObservationIgnored private let navigator: Navigator
    @ObservationIgnored private let clock: AppClock
    @ObservationIgnored private let center = UNUserNotificationCenter.current()
    @ObservationIgnored private let simulatesDenial: Bool
    @ObservationIgnored private var simulatedAnswer = false
    @ObservationIgnored private var nudged = false
    @ObservationIgnored private var resync: Task<Void, Never>?

    init(store: Store, toasts: Toasts, navigator: Navigator, clock: AppClock) {
        self.store = store
        self.toasts = toasts
        self.navigator = navigator
        self.clock = clock
        #if DEBUG
        simulatesDenial = (try? LaunchOptions.parse(ProcessInfo.processInfo.environment))?.notificationsDenied ?? false
        #else
        simulatesDenial = false
        #endif
        super.init()
        center.delegate = self
    }

    /// Turned on in this app. iOS has no way to give a permission back, so `Turn off` clears this instead.
    private var enabled: Bool {
        get { UserDefaults.standard.bool(forKey: Self.enabledKey) }
        set { UserDefaults.standard.set(newValue, forKey: Self.enabledKey) }
    }

    /// Detects the status, refills the window, and shows reminders that came up while closed, then checks for due
    /// reminders every minute while the app runs.
    func run() async {
        await detect()
        fireDueReminders()
        while !Task.isCancelled {
            let seconds = 60 - clock.now.timeIntervalSince1970.truncatingRemainder(dividingBy: 60)
            try? await Task.sleep(for: .seconds(seconds))
            fireDueReminders()
        }
    }

    /// Re-reads the permission, which can change in Settings while the app is away.
    func detect() async {
        let authorization = await authorizationStatus()
        status = switch authorization {
        case .denied: .denied
        case .authorized, .provisional, .ephemeral: enabled ? .on : .off
        case .notDetermined: .off
        @unknown default: .off
        }
        await sync()
    }

    private func authorizationStatus() async -> UNAuthorizationStatus {
        if simulatesDenial { return simulatedAnswer ? .denied : .notDetermined }
        return await center.notificationSettings().authorizationStatus
    }

    /// The only place the app asks for permission: `Turn on notifications`.
    func enable() async {
        guard status == .off else { return }
        let granted: Bool
        if simulatesDenial {
            simulatedAnswer = true
            granted = false
        } else {
            granted = (try? await center.requestAuthorization(options: [.alert, .sound])) ?? false
        }
        enabled = granted
        await detect()
    }

    func disable() async {
        enabled = false
        await detect()
    }

    /// Schedules a notification five seconds out. `false` means it could not be scheduled.
    func sendTest() async -> Bool {
        guard status == .on else { return false }
        let content = UNMutableNotificationContent()
        content.title = "Notifications are on"
        content.body = "Procrastimate will notify you here when tasks are due."
        content.sound = .default
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: 5, repeats: false)
        do {
            try await center.add(UNNotificationRequest(identifier: Self.testID, content: content, trigger: trigger))
        } catch {
            return false
        }
        await readPending()
        return true
    }

    /// Call after every change to the tasks. Recomputes the schedule once a burst of changes settles, and offers the
    /// Notifications screen once per launch when a change first gives a task a time to notify.
    func tasksChanged(from old: [TaskItem], to new: [TaskItem]) {
        resync?.cancel()
        resync = Task {
            try? await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled else { return }
            await sync()
        }
        guard !nudged, status == .off else { return }
        let before = Dictionary(old.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        let zone = clock.timeZone
        let notifies = { (task: TaskItem) in !Notifications.notificationTimes(task.due, task.reminders, in: zone).isEmpty }
        // Imported tasks carry a source key, and an import is not a save.
        let saved = new.contains { task in
            task.sourceKey == nil && task.completedAt == nil && notifies(task) && !(before[task.id].map(notifies) ?? false)
        }
        guard saved else { return }
        nudged = true
        toasts.show(
            "Get notified when it’s due?",
            action: .init(label: "Turn on") { [navigator] in navigator.openNotifications() },
            for: .seconds(8)
        )
    }

    /// Replaces the pending requests with the soonest moments of open tasks, or clears them while notifications are
    /// off. Re-adding an identifier replaces its request, so edits, completions, and undos need no cancel path.
    func sync() async {
        switch status {
        case .checking:
            return
        case .off, .denied:
            center.removeAllPendingNotificationRequests()
            pending = []
            return
        case .on:
            break
        }
        let now = clock.now
        let schedule = Notifications.upcomingNotifications(
            store.tasks, now: now, limit: Notifications.maxScheduled, in: clock.timeZone
        )
        let held = await center.pendingNotificationRequests().map {
            Notifications.Pending(id: $0.identifier, title: $0.content.title, body: $0.content.body)
        }
        let change = Notifications.scheduleChange(schedule, pending: held)
        center.removePendingNotificationRequests(withIdentifiers: change.remove)
        for item in change.add {
            try? await center.add(request(item, now: now))
        }
        await readPending()
        scheduleRefresh(schedule)
    }

    /// A moment is an instant, so the trigger counts down from the app's clock. That also keeps a pinned test clock
    /// meaningful, where a calendar date would already be in the past.
    private func request(_ item: Notifications.Scheduled, now: Date) -> UNNotificationRequest {
        let content = UNMutableNotificationContent()
        content.title = item.title
        content.body = item.body
        content.sound = .default
        content.threadIdentifier = item.taskId
        content.userInfo = ["taskId": item.taskId]
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: max(1, item.at.timeIntervalSince(now)), repeats: false)
        return UNNotificationRequest(identifier: item.tag, content: content, trigger: trigger)
    }

    private func readPending() async {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let requests = await center.pendingNotificationRequests()
        pending = requests
            .map { request -> (Int, String) in
                let id = request.identifier
                let at = Notifications.isTaskTag(id) ? Int(id[id.index(after: id.lastIndex(of: ":")!)...]) ?? 0 : Int.max
                let time = at == Int.max ? id : formatter.string(from: Date(epochMilliseconds: at))
                return (at, "\(request.content.title)@\(time): \(request.content.body)")
            }
            .sorted { $0 < $1 }
            .map(\.1)
    }

    /// A full window refills from a background refresh before it runs dry, in case the app stays closed.
    private func scheduleRefresh(_ schedule: [Notifications.Scheduled]) {
        guard schedule.count == Notifications.maxScheduled else { return }
        let request = BGAppRefreshTaskRequest(identifier: Self.refreshTaskID)
        request.earliestBeginDate = schedule[schedule.count / 2].at
        try? BGTaskScheduler.shared.submit(request)
    }

    /// Shows `Reminder: <title>` with `Open` for every moment that came up since the last check, like the web.
    func fireDueReminders() {
        let now = clock.now.epochMilliseconds
        let since = store.snapshot.remindersCheckedAt
        guard now > since else { return }
        for task in Notifications.dueReminders(store.tasks, since: since, now: now, in: clock.timeZone) {
            let id = task.id
            toasts.show(
                Format.reminderToast(task.title),
                action: .init(label: "Open") { [navigator] in navigator.openTask(id) },
                for: .seconds(12)
            )
        }
        store.markRemindersChecked(at: now)
    }

    fileprivate func open(_ taskId: String) {
        guard store.task(taskId) != nil else { return }
        navigator.openTask(taskId)
    }
}

extension LocalNotifications: UNUserNotificationCenterDelegate {
    /// In the foreground a task's moment shows as the reminder toast, never a banner. The test notification still shows,
    /// since it is what `Send a test notification` asked for.
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        let isTest = notification.request.identifier == Self.testID
        await MainActor.run { self.fireDueReminders() }
        return isTest ? [.banner, .sound] : []
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        guard let taskId = response.notification.request.content.userInfo["taskId"] as? String else { return }
        await MainActor.run { self.open(taskId) }
    }
}

extension Navigator {
    /// Opens a task from a notification or a reminder toast.
    func openTask(_ id: String) {
        sheet = .details(taskID: id)
    }

    /// The Notifications screen inside Browse, closing any sheet first, like the web's nudge.
    func openNotifications() {
        sheet = nil
        tab = .browse
        paths[.browse] = [.notifications]
    }
}
