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

    /// Detects the status, asks on first launch, refills the window, and shows reminders that came up while closed.
    /// reminders every minute while the app runs.
    func run() async {
        if await authorizationStatus() == .notDetermined {
            if simulatesDenial {
                simulatedAnswer = true
            } else {
                _ = try? await center.requestAuthorization(options: [.alert, .sound])
            }
        }
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
        case .authorized, .provisional, .ephemeral: .on
        case .notDetermined: .off
        @unknown default: .off
        }
        await sync()
    }

    private func authorizationStatus() async -> UNAuthorizationStatus {
        if simulatesDenial { return simulatedAnswer ? .denied : .notDetermined }
        return await center.notificationSettings().authorizationStatus
    }

    /// The settings line, when permission was blocked. Opens the system Settings app.
    func openSettings() async {
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        await UIApplication.shared.open(url)
    }

    /// Call after every change to the tasks. Recomputes the schedule once a burst of changes settles.
    func tasksChanged(from _: [TaskItem], to _: [TaskItem]) {
        resync?.cancel()
        resync = Task {
            try? await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled else { return }
            await sync()
        }
    }

    /// Writes the device schedule from a store, without the open app's status. An intent uses this when it changes
    /// tasks before the view is subscribed, or while the app is not showing. It does not ask for permission.
    static func applySchedule(store: Store, clock: AppClock) async {
        let center = UNUserNotificationCenter.current()
        guard await notificationsAllowed() else {
            if await notificationsBlocked() { center.removeAllPendingNotificationRequests() }
            return
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
            try? await center.add(makeRequest(item, now: now))
        }
        guard schedule.count == Notifications.maxScheduled else { return }
        let refresh = BGAppRefreshTaskRequest(identifier: refreshTaskID)
        refresh.earliestBeginDate = schedule[schedule.count / 2].at
        try? BGTaskScheduler.shared.submit(refresh)
    }

    private static func notificationsAllowed() async -> Bool {
        switch await UNUserNotificationCenter.current().notificationSettings().authorizationStatus {
        case .authorized, .provisional, .ephemeral: return true
        case .notDetermined, .denied: return false
        @unknown default: return false
        }
    }

    /// The system said no. Not-yet-asked stays as it is.
    private static func notificationsBlocked() async -> Bool {
        await UNUserNotificationCenter.current().notificationSettings().authorizationStatus == .denied
    }

    private static func makeRequest(_ item: Notifications.Scheduled, now: Date) -> UNNotificationRequest {
        let content = UNMutableNotificationContent()
        content.title = item.title
        content.body = item.body
        content.sound = .default
        content.threadIdentifier = item.taskId
        content.userInfo = ["taskId": item.taskId]
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: max(1, item.at.timeIntervalSince(now)), repeats: false)
        return UNNotificationRequest(identifier: item.tag, content: content, trigger: trigger)
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
        Self.makeRequest(item, now: now)
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

    /// A place crossing while the app is open, which no schedule knows about, shows like a reminder toast.
    fileprivate func showPlaceToast(_ taskId: String, title: String, body: String) {
        toasts.show(
            "\(title) · \(body)",
            action: .init(label: "Open") { [navigator] in navigator.openTask(taskId) },
            for: .seconds(12)
        )
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
        let request = notification.request
        let isTest = request.identifier == Self.testID
        let place = request.identifier.hasPrefix(PlaceMonitor.notificationPrefix)
            ? (request.content.userInfo["taskId"] as? String, request.content.title, request.content.body) : nil
        await MainActor.run {
            self.fireDueReminders()
            if let place, let taskId = place.0 { self.showPlaceToast(taskId, title: place.1, body: place.2) }
        }
        return isTest ? [.banner, .sound] : []
    }

    /// UIKit asserts when this completion runs off the main thread, which the `async` form of this method does.
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let taskId = response.notification.request.content.userInfo["taskId"] as? String
        nonisolated(unsafe) let done = completionHandler
        DispatchQueue.main.async {
            MainActor.assumeIsolated {
                if let taskId { self.open(taskId) }
            }
            done()
        }
    }
}

extension Navigator {
    /// Opens a task from a notification or a reminder toast.
    func openTask(_ id: String) {
        sheet = .details(taskID: id)
    }

}
