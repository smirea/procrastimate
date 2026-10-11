import Core
import SwiftUI

@main
struct ProcrastimateApp: App {
    @State private var navigator = Navigator()
    @State private var toasts: Toasts
    @State private var store: Store
    @State private var actions: TaskActions
    private let clock: AppClock

    init() {
        let clock = Launch.prepare()
        let toasts = Toasts()
        let store = Store(file: SnapshotFile(url: StoreLocation.file), clock: clock)
        self.clock = clock
        _toasts = State(initialValue: toasts)
        _store = State(initialValue: store)
        _actions = State(initialValue: TaskActions(store: store, toasts: toasts, clock: clock))
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(navigator)
                .environment(store)
                .environment(toasts)
                .environment(actions)
                .environment(\.clock, clock)
        }
    }
}
