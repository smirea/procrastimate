import Core
import CoreSpotlight
import EventKit
import Feedback
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
    @State private var sync: SyncClient
    @State private var attachments: TaskAttachments
    @State private var auth: Session
    @State private var places: PlaceMonitor
    @State private var calendar: CalendarSync
    @State private var today: DateKey
    @Environment(\.scenePhase) private var scenePhase
    private let clock: AppClock

    init() {
        Telemetry.start()
        CaretKeeper.shared.start()
        ImagePaste.shared.start()
        let clock = Launch.prepare()
        let navigator = Navigator(clock: clock)
        let toasts = Toasts()
        let sync = SyncClient.shared(clock: clock)
        let store = sync.store
        store.labelColorSuggester = { await LabelColorModel.color(for: $0) }
        let actions = TaskActions(store: store, toasts: toasts, clock: clock)
        // The delegate must be set before launch finishes, so tapping a notification can cold-start into its task.
        let notifications = LocalNotifications(store: store, navigator: navigator, clock: clock)
        let auth = Session(sync: sync)
        sync.session = auth
        sync.toasts = toasts
        let attachments = TaskAttachments(store: store, toasts: toasts)
        // Created at launch so a relaunch for a place crossing finds its listener.
        let places = PlaceMonitor(store: store, clock: clock)
        IntentSession(store: store, navigator: navigator, clock: clock, notifications: notifications, places: places).install()
        // Tasks were in Spotlight until Siri, Shortcuts, and Spotlight support was dropped; this clears what an earlier
        // build indexed, so no stale result stays in the phone's search.
        CSSearchableIndex.default().deleteAllSearchableItems()
        _places = State(initialValue: places)
        _calendar = State(initialValue: CalendarSync(store: store, clock: clock))
        Task { await places.start() }
        self.clock = clock
        _today = State(initialValue: clock.today)
        _theme = State(initialValue: ThemeSettings.shared)
        _navigator = State(initialValue: navigator)
        _toasts = State(initialValue: toasts)
        _store = State(initialValue: store)
        _actions = State(initialValue: actions)
        _notifications = State(initialValue: notifications)
        _importer = State(initialValue: TodoistImport(store: store, clock: clock))
        _auth = State(initialValue: auth)
        _sync = State(initialValue: sync)
        _attachments = State(initialValue: attachments)
        Feedback.enable()
        Feedback.context("Session") { (api: AppEnvironment.apiURL.absoluteString, signedIn: auth.signedIn, user: Session.userID) }
        Feedback.context("Sync") { (status: sync.engine.status, pendingWrites: sync.engine.pending) }
        Feedback.context("Navigation") { (tab: navigator.tab, route: navigator.currentRoute, sheet: navigator.sheet) }
        Feedback.context("Store") {
            (tasks: store.allTasks.count, projects: store.projects.count, labels: store.labels.count, spaces: store.spaces.count)
        }
    }

    var body: some Scene {
        WindowGroup {
            provided(RootView())
                .background { SheetWindow { provided(AppSheets()).environment(\.scenePhase, scenePhase) } }
                .onAppear { theme.apply() }
                .task { await notifications.run() }
                .task {
                    await auth.start()
                    // Before sync, whose bound transaction would otherwise take the smoke's API calls.
                    await Telemetry.smokeIfAsked()
                    sync.start()
                }
                .task(id: auth.signedIn) { await FeedbackIssues.refresh(signedIn: auth.signedIn) }
                .onChange(of: store.people) { _, people in DeviceDefaults.people = people }
                .onChange(of: store.tasks) { old, new in notifications.tasksChanged(from: old, to: new) }
                .onChange(of: store.tasks) { _, _ in
                    places.tasksChanged()
                    navigator.tasksChanged(in: store)
                }
                .task {
                    calendar.sync()
                    for await _ in NotificationCenter.default.notifications(named: .EKEventStoreChanged) { calendar.sync() }
                }
                .modifier(WidgetSync.Follow(store: store, theme: theme, auth: auth, clock: clock))
                .task { await PerfDemo.run(store: store, clock: clock, navigator: navigator, actions: actions) }
                .task { await SharingDemo.run(sync: sync) }
                .task {
                    SectionsDemo.run(store: store, navigator: navigator, clock: clock)
                    WidgetsDemo.run(store: store, clock: clock)
                    await PlacesDemo.run(store: store, calendar: calendar, navigator: navigator, clock: clock)
                }
                .onOpenURL { open($0) }
                .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
                    if let url = activity.webpageURL { open(url) }
                }
                .onMessage(of: UIApplication.self, for: .significantTimeChange) { _ in
                    today = clock.today
                    Task { await notifications.sync() }
                }
                .onChange(of: scenePhase) { old, new in phaseChanged(from: old, to: new) }
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

    /// What the root of each window reads: the tabs' window and the sheets' (see `SheetWindow`).
    private func provided(_ view: some View) -> some View {
        view
            .environment(navigator)
            .environment(store)
            .environment(toasts)
            .environment(actions)
            .environment(theme)
            .environment(notifications)
            .environment(importer)
            .environment(auth)
            .environment(sync)
            .environment(attachments)
            .environment(places)
            .environment(calendar)
            .environment(\.clock, clock)
            .environment(\.today, today)
            .environment(\.openURL, OpenURLAction(handler: openInApp))
            // The scene's `.backgroundTask` below stops SwiftUI from applying the asset's global accent (everything
            // went system blue), so each root sets it explicitly.
            .tint(.accent)
            .motionFollowsAccessibility()
    }

    private func phaseChanged(from old: ScenePhase, to new: ScenePhase) {
        // On the way back, before `.active`, so stale tabs reset before the first frame shows.
        if new == .background {
            navigator.leftApp()
        } else if old == .background {
            navigator.returnedToApp(covered: Self.presenting)
        }
        guard new == .active else { return }
        today = clock.today
        sync.resume()
        calendar.sync()
        Task { await notifications.detect() }
        Task { await places.sync() }
    }

    /// Whether a sheet, alert, or menu is up over the tabs, in UIKit's terms, since SwiftUI doesn't expose an alert a
    /// screen presents.
    private static var presenting: Bool {
        UIApplication.shared.connectedScenes
            .flatMap { ($0 as? UIWindowScene)?.windows ?? [] }
            .contains { $0.rootViewController?.presentedViewController != nil }
    }

    /// A link in the app's text to the app's own web URLs opens in place, since iOS never hands a Universal Link back
    /// to the app it was tapped in.
    private func openInApp(_ url: URL) -> OpenURLAction.Result {
        if auth.signedIn, let id = Links.taskLinkId(url.absoluteString) {
            if store.task(id) == nil {
                toasts.show("Can’t find that task")
            } else {
                navigator.open(.task(id: id), in: store, today: clock.today)
            }
        } else if let token = SharedLinks.token(in: url) {
            navigator.sheet = .sharedLink(token: token)
        } else {
            return .systemAction
        }
        return .handled
    }

    private func open(_ url: URL) {
        if url.pathExtension.lowercased() == "zip" {
            importer.run(url)
            navigator.sheet = .settings
        } else if let token = SharedLinks.token(in: url) {
            navigator.sheet = .sharedLink(token: token)
        } else if let link = AppLink(url) {
            navigator.open(link, in: store, today: clock.today)
        }
    }
}
