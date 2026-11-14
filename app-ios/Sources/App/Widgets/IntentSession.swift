import Core
import Foundation

/// The live store, navigation, and clock the widget and control intents use (`WidgetIntents.swift`).
/// `ProcrastimateApp.init` installs it before any intent can run, since the system launches the app to run one.
@MainActor
final class IntentSession {
    static var current: IntentSession!

    let store: Store
    let navigator: Navigator
    let clock: AppClock
    let notifications: LocalNotifications
    let places: PlaceMonitor

    init(store: Store, navigator: Navigator, clock: AppClock, notifications: LocalNotifications, places: PlaceMonitor) {
        self.store = store
        self.navigator = navigator
        self.clock = clock
        self.notifications = notifications
        self.places = places
    }

    func install() { Self.current = self }

    /// A widget's checkbox names the task it drew. A task already done or gone, such as one completed on another device
    /// since, is left alone. Returns once the local database holds the command, since the system may suspend the process
    /// as soon as the intent returns, even with the app open.
    func complete(_ taskID: String) async {
        if let task = store.task(taskID), task.completedAt == nil { _ = store.completeTask(task.id) }
        await storeChanged()
        await SyncClient.shared(clock: clock).saved()
    }

    func open(_ url: URL) {
        guard let link = AppLink(url) else { return }
        navigator.open(link, in: store, today: clock.today)
    }

    /// Everything that follows the store, brought in line before an intent answers: the open app's views do it on the
    /// next frame, which is too late when the intent ran first, and never when the app is not showing.
    private func storeChanged() async {
        WidgetSync.write(store, clock: clock)
        await notifications.resync()
        await places.sync()
    }
}
