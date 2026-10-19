import BackgroundTasks
import Core
import Foundation
import Observation
import SwiftUI
@preconcurrency import UserNotifications

enum NotificationStatus: Equatable {
    case checking
    case off
    case denied
    case on

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
@MainActor @Observable
final class LocalNotifications: NSObject {
    nonisolated static let refreshTaskID = "com.stefan.procrastimate.refresh"

    private(set) var status: NotificationStatus = .checking

    @ObservationIgnored private let store: Store
    @ObservationIgnored private let navigator: Navigator
    @ObservationIgnored private let clock: AppClock
    @ObservationIgnored private let center = UNUserNotificationCenter.current()
    @ObservationIgnored private let simulatesDenial: Bool
    @ObservationIgnored private var simulatedAnswer = false
    @ObservationIgnored private var debounce: Task<Void, Never>?
    @ObservationIgnored private var running: Task<Void, Never>?

    init(store: Store, navigator: Navigator, clock: AppClock) {
        self.store = store
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

    func run() async {
        if await authorizationStatus() == .notDetermined {
            if simulatesDenial {
                simulatedAnswer = true
            } else {
                _ = try? await center.requestAuthorization(options: [.alert, .sound])
            }
        }
        await detect()
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

    func openSettings() async {
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        await UIApplication.shared.open(url)
    }

    func tasksChanged(from _: [TaskItem], to _: [TaskItem]) {
        debounce?.cancel()
        debounce = Task {
            try? await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled else { return }
            await sync()
        }
    }

    /// The schedule after a change made before the view is subscribed, as an intent's: reads the permission first when
    /// `run` has not yet, and does not ask for it.
    func resync() async {
        if status == .checking { await detect() } else { await sync() }
    }

    /// Replaces the pending requests with the soonest moments of open tasks, or clears them while notifications are
    /// off. Re-adding an identifier replaces its request, so edits, completions, and undos need no cancel path. Two
    /// passes never interleave: one reading the pending requests while another adds would schedule a completed task.
    func sync() async {
        let previous = running
        let task = Task {
            await previous?.value
            await apply()
        }
        running = task
        await task.value
    }

    /// A moment is an instant, so the trigger counts down from the app's clock. That also keeps a pinned test clock
    /// meaningful, where a calendar date would already be in the past.
    private static func makeRequest(_ item: Notifications.Scheduled, now: Date) -> UNNotificationRequest {
        let content = UNMutableNotificationContent()
        content.title = item.title
        content.body = item.body
        content.sound = .default
        content.interruptionLevel = .timeSensitive
        content.threadIdentifier = item.taskId
        content.userInfo = ["taskId": item.taskId]
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: max(1, item.at.timeIntervalSince(now)), repeats: false)
        return UNNotificationRequest(identifier: item.tag, content: content, trigger: trigger)
    }

    private func apply() async {
        switch status {
        case .checking:
            return
        case .off, .denied:
            center.removeAllPendingNotificationRequests()
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
            try? await center.add(Self.makeRequest(item, now: now))
        }
        scheduleRefresh(schedule)
    }

    /// A full window refills from a background refresh before it runs dry, in case the app stays closed.
    private func scheduleRefresh(_ schedule: [Notifications.Scheduled]) {
        guard schedule.count == Notifications.maxScheduled else { return }
        let request = BGAppRefreshTaskRequest(identifier: Self.refreshTaskID)
        request.earliestBeginDate = schedule[schedule.count / 2].at
        Task { try? await BGTaskScheduler.shared.submitTaskRequest(request) }
    }

    fileprivate func open(_ taskId: String) {
        guard store.task(taskId) != nil else { return }
        navigator.openTask(taskId)
    }
}

extension LocalNotifications: UNUserNotificationCenterDelegate {
    /// The open app shows the system banner too, so a reminder looks the same in the foreground as in the background.
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }

    /// UIKit asserts when this completion runs off the main thread, which the `async` form of this method does.
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let taskId = response.notification.request.content.userInfo["taskId"] as? String
        nonisolated(unsafe) let done = completionHandler
        Task { @MainActor in
            if let taskId { self.open(taskId) }
            done()
        }
    }
}

extension Navigator {
    func openTask(_ id: String) {
        sheet = .details(taskID: id)
    }

}
