import Core
import EventKit
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
    @State private var accountSync: AccountSync
    @State private var auth: Session
    @State private var router: IntentRouter
    @State private var places: PlaceMonitor
    @State private var calendar: CalendarSync
    @State private var today: DateKey
    @Environment(\.scenePhase) private var scenePhase
    private let clock: AppClock
    private let session: IntentSession

    init() {
        let clock = Launch.prepare()
        let navigator = Navigator()
        let toasts = Toasts()
        let store = Store(file: SnapshotFile(url: StoreLocation.file), clock: clock)
        let actions = TaskActions(store: store, toasts: toasts, clock: clock)
        let router = IntentRouter()
        // The delegate must be set before launch finishes, so tapping a notification can cold-start into its task.
        let notifications = LocalNotifications(store: store, toasts: toasts, navigator: navigator, clock: clock)
        let auth = Session(store: store)
        let accountSync = AccountSync(store: store, clock: clock, session: auth)
        let session = IntentSession(
            store: store,
            navigator: navigator,
            actions: actions,
            toasts: toasts,
            clock: clock,
            router: router,
            notifications: notifications
        )
        session.install()
        ProcrastimateShortcuts.updateAppShortcutParameters()
        // Created at launch so a relaunch for a place crossing finds its listener.
        let places = PlaceMonitor(store: store, clock: clock)
        _places = State(initialValue: places)
        _calendar = State(initialValue: CalendarSync(store: store, clock: clock))
        Task { await places.start() }
        self.clock = clock
        self.session = session
        _today = State(initialValue: clock.today)
        _theme = State(initialValue: ThemeSettings())
        _navigator = State(initialValue: navigator)
        _toasts = State(initialValue: toasts)
        _store = State(initialValue: store)
        _actions = State(initialValue: actions)
        _router = State(initialValue: router)
        _notifications = State(initialValue: notifications)
        _importer = State(initialValue: TodoistImport(store: store, clock: clock))
        _auth = State(initialValue: auth)
        _accountSync = State(initialValue: accountSync)
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
                .environment(auth)
                .environment(accountSync)
                .environment(router)
                .environment(places)
                .environment(calendar)
                .environment(\.clock, clock)
                .environment(\.today, today)
                .onAppear { theme.apply() }
                // The scene's `.backgroundTask` below stops SwiftUI from applying the asset's global accent (everything
                // went system blue), so the root sets it explicitly.
                .tint(.accent)
                .motionFollowsAccessibility()
                .task { await notifications.run() }
                .task {
                    await auth.start()
                    accountSync.start()
                }
                .onChange(of: store.revision) { _, _ in accountSync.syncSoon() }
                .onChange(of: store.tasks) { old, new in notifications.tasksChanged(from: old, to: new) }
                .onChange(of: store.tasks) { _, _ in places.tasksChanged() }
                .task { calendar.sync() }
                .onReceive(NotificationCenter.default.publisher(for: .EKEventStoreChanged)) { _ in calendar.sync() }
                .onChange(of: store.tasks) { _, _ in SpotlightIndex.schedule(session) }
                .onChange(of: store.projects) { _, _ in SpotlightIndex.schedule(session) }
                .onChange(of: store.labels) { _, _ in SpotlightIndex.schedule(session) }
                .task { SpotlightIndex.schedule(session) }
                .task { await IntentHarness.run() }
                .task { await PlacesDemo.run(store: store, calendar: calendar, navigator: navigator, clock: clock) }
                // An overlay sits outside the `.environment` calls above, so it gets the router itself; without it every
                // launch traps on the missing `IntentRouter`.
                .overlay(alignment: .top) { IntentReadout().environment(router) }
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
                    accountSync.syncNow()
                    calendar.sync()
                    Task { await notifications.detect() }
                    Task { await places.sync() }
                }
        }
        .backgroundTask(.appRefresh(LocalNotifications.refreshTaskID)) { [notifications, calendar, places] in
            await calendar.sync()
            await notifications.detect()
            await places.sync()
        }
        .backgroundTask(.appRefresh(PlaceMonitor.refreshTaskID)) { [calendar, places] in
            await calendar.sync()
            await places.sync()
        }
    }
}
