import Core

/// The live store, navigation, and clock the intents use. Registered from `ProcrastimateApp.init` before any intent runs.
@MainActor
final class IntentSession {
    static var current: IntentSession?

    let store: Store
    let navigator: Navigator
    let actions: TaskActions
    let toasts: Toasts
    let clock: AppClock
    let router: IntentRouter

    init(store: Store, navigator: Navigator, actions: TaskActions, toasts: Toasts, clock: AppClock, router: IntentRouter) {
        self.store = store
        self.navigator = navigator
        self.actions = actions
        self.toasts = toasts
        self.clock = clock
        self.router = router
    }

    func install() { Self.current = self }
}
