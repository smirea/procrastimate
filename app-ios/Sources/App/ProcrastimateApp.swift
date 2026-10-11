import Core
import SwiftUI

@main
struct ProcrastimateApp: App {
    @State private var navigator: Navigator
    @State private var toasts: Toasts
    @State private var store: Store
    @State private var actions: TaskActions
    @State private var theme: ThemeSettings
    @State private var notifications: LocalNotifications
    @State private var importer: TodoistImport
    @State private var today: DateKey
    @Environment(\.scenePhase) private var scenePhase
    private let clock: AppClock

    init() {
        let clock = Launch.prepare()
        let navigator = Navigator()
        let toasts = Toasts()
        let store = Store(file: SnapshotFile(url: StoreLocation.file), clock: clock)
        self.clock = clock
        _today = State(initialValue: clock.today)
        _theme = State(initialValue: ThemeSettings())
        _navigator = State(initialValue: navigator)
        _toasts = State(initialValue: toasts)
        _store = State(initialValue: store)
        _actions = State(initialValue: TaskActions(store: store, toasts: toasts, clock: clock))
        // The delegate must be set before launch finishes, so tapping a notification can cold-start into its task.
        _notifications = State(initialValue: LocalNotifications(store: store, toasts: toasts, navigator: navigator, clock: clock))
        _importer = State(initialValue: TodoistImport(store: store, clock: clock))
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(navigator)
                .environment(store)
                .environment(toasts)
                .environment(actions)
                .environment(theme)
                .environment(notifications)
                .environment(importer)
                .environment(\.clock, clock)
                .environment(\.today, today)
                .onAppear { theme.apply() }
                .motionFollowsAccessibility()
                .task { await notifications.run() }
                .onChange(of: store.tasks) { old, new in notifications.tasksChanged(from: old, to: new) }
                .onOpenURL { url in
                    guard url.pathExtension.lowercased() == "zip" else { return }
                    importer.run(url)
                    navigator.sheet = .settings
                }
                .onReceive(NotificationCenter.default.publisher(for: UIApplication.significantTimeChangeNotification)) { _ in
                    today = clock.today
                    Task { await notifications.sync() }
                }
                .onChange(of: scenePhase) {
                    guard scenePhase == .active else { return }
                    today = clock.today
                    notifications.fireDueReminders()
                    Task { await notifications.detect() }
                }
        }
        .backgroundTask(.appRefresh(LocalNotifications.refreshTaskID)) { [notifications] in
            await notifications.detect()
        }
    }
}
