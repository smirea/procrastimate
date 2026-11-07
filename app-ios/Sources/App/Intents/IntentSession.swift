import Core

/// The live store, navigation, and clock the intents use. `ProcrastimateApp.init` installs it before any intent can run,
/// since the system launches the app to run one.
@MainActor
final class IntentSession {
    static var current: IntentSession!

    let store: Store
    let navigator: Navigator
    let actions: TaskActions
    let toasts: Toasts
    let clock: AppClock
    let router: IntentRouter
    let notifications: LocalNotifications
    let places: PlaceMonitor

    init(
        store: Store,
        navigator: Navigator,
        actions: TaskActions,
        toasts: Toasts,
        clock: AppClock,
        router: IntentRouter,
        notifications: LocalNotifications,
        places: PlaceMonitor
    ) {
        self.store = store
        self.navigator = navigator
        self.actions = actions
        self.toasts = toasts
        self.clock = clock
        self.router = router
        self.notifications = notifications
        self.places = places
    }

    func install() { Self.current = self }

    /// Everything that follows the store, brought in line before an intent answers: the open app's views do it on the
    /// next frame, which is too late when the intent ran first, and never when the app is not showing.
    func storeChanged() async {
        SpotlightIndex.schedule(self)
        WidgetSync.write(store, clock: clock)
        await notifications.resync()
        await places.sync()
    }
}
