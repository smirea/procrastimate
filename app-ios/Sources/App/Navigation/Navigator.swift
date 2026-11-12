import Core
import Foundation
import Observation

@MainActor @Observable
final class Navigator {
    /// Coming to Browse from another tab starts a fresh search, like the web's search sheet. Back from a result keeps
    /// the query, because that never leaves Browse.
    var tab: AppTab {
        didSet {
            if tab != oldValue {
                if tab == .browse { searchQuery = "" }
                memory.hide(oldValue, at: clock.now)
                memory.show(tab)
                scheduleReset()
            }
            forgetAddedElsewhere()
        }
    }
    /// The tab bar's screens before Browse, in order. Kept per device, since how many fit depends on the screen.
    private(set) var pins: [Pin]
    var searchQuery = ""
    var paths: [AppTab: [Route]] = [:] {
        didSet { forgetAddedElsewhere() }
    }
    /// Any sheet, such as quick add, cancels a task link still waiting for sync, so the task cannot replace it later.
    var sheet: Sheet? {
        didSet {
            if sheet != nil { awaitedTask = nil }
            if !keepsAdded(from: oldValue) { added = nil }
        }
    }
    /// The task quick add last saved, which shows as a card above quick add and then over its own details. It lives only
    /// while one of those is open, so any other sheet change drops it.
    var added: String?
    /// Asks Browse to focus its search field, as Cmd-K does. Browse clears it once focused.
    var focusSearch = false
    /// Bumped when a tab goes back to its default state, so its screens rebuild at the top while it is out of sight.
    private(set) var resets: [AppTab: Int] = [:]

    @ObservationIgnored private let clock: AppClock
    @ObservationIgnored private var memory = TabMemory<AppTab>()
    @ObservationIgnored private var resetTimer: Task<Void, Never>?
    /// A task link that came before sync brought its task, such as Feedback's for a task it just posted. It opens when
    /// the task lands within a minute, unless a sheet or another link came first; later, it would pop up over whatever
    /// the user moved on to.
    @ObservationIgnored private var awaitedTask: (id: String, until: Date)?

    static let pinsKey = "procrastimate-pins"

    init(clock: AppClock) {
        self.clock = clock
        let stored = UserDefaults.standard.data(forKey: Self.pinsKey)
            .flatMap { try? JSONDecoder().decode([Pin].self, from: $0) }
        let pins = stored ?? Pin.defaults
        self.pins = pins
        tab = pins.first.map(AppTab.pin) ?? .browse
    }

    /// The screen on top of the open tab: its pushed route, else the pinned screen at its root. Nil on Browse's root.
    var currentRoute: Route? {
        if let route = paths[tab]?.last { return route }
        if case let .pin(pin) = tab { return pin.route }
        return nil
    }

    /// The app went to the background, which takes the open tab out of sight too.
    func leftApp() {
        memory.hide(tab, at: clock.now)
    }

    /// The app is back. Every tab away for `TabReset.after` resets before it draws, except the open one while something
    /// is presented over it, such as task details or an alert, which may hold an unsaved draft.
    func returnedToApp(covered: Bool) {
        for stale in memory.stale(at: clock.now, keeping: covered || sheet != nil ? tab : nil) { reset(stale) }
        memory.show(tab)
        scheduleReset()
    }

    private func reset(_ tab: AppTab) {
        paths[tab] = []
        resets[tab, default: 0] += 1
        if tab == .browse { searchQuery = "" }
    }

    /// Resets each hidden tab as its time comes, while it is still out of sight. The open tab only resets on returning
    /// to the app, which checks what is presented over it.
    private func scheduleReset() {
        resetTimer?.cancel()
        guard let due = memory.nextReset(keeping: tab) else { return }
        resetTimer = Task { [weak self, clock] in
            try? await Task.sleep(for: .seconds(max(0, due.timeIntervalSince(clock.now))))
            guard !Task.isCancelled, let self else { return }
            for stale in memory.stale(at: clock.now, keeping: tab) { reset(stale) }
            scheduleReset()
        }
    }

    func setPins(_ next: [Pin]) {
        let removed = pins.filter { !next.contains($0) }
        pins = next
        if let data = try? JSONEncoder().encode(next) { UserDefaults.standard.set(data, forKey: Self.pinsKey) }
        for pin in removed { paths[.pin(pin)] = nil }
        if case let .pin(pin) = tab, !next.contains(pin) { tab = next.first.map(AppTab.pin) ?? .browse }
    }

    /// A tab menu's pick: the tab's place in the bar holds `next` from now on, open at its root.
    func swap(_ pin: Pin, to next: Pin) {
        guard let index = pins.firstIndex(of: pin), !pins.contains(next) else { return }
        var updated = pins
        updated[index] = next
        setPins(updated)
        paths[.pin(next)] = []
        tab = .pin(next)
    }

    /// Opens a screen in its own tab when it is pinned, else on top of Browse.
    func open(_ route: Route) {
        if let pin = pins.first(where: { $0.route == route }) {
            paths[.pin(pin)] = []
            tab = .pin(pin)
        } else {
            paths[.browse] = [route]
            tab = .browse
        }
    }

    /// Quick add's defaults while it is open. It shows as an overlay attached to the keyboard, not as a sheet.
    var quickAdd: QuickAddDefaults? {
        if case let .quickAdd(defaults) = sheet { defaults } else { nil }
    }

    /// Ramble's defaults while it is open. Like quick add, it is an overlay, so it can rise with its own spring.
    var ramble: QuickAddDefaults? {
        if case let .ramble(defaults) = sheet { defaults } else { nil }
    }

    /// The task the last quick add saved, which the next one on the same screen starts from.
    @ObservationIgnored private var reused: (tab: AppTab, route: Route?, task: TaskItem)?

    /// Quick add from the tab bar starts with the context of the screen on top, as `Screens.defaults` maps it, or
    /// where the last quick add on that screen saved its task.
    func listDefaults(_ store: Store) -> QuickAddDefaults {
        let own = store.quickAddDefaults(currentRoute?.screen)
        guard let reused, reused.tab == tab, reused.route == currentRoute else { return own }
        return Screens.reusedDefaults(reused.task, store.labels, date: own.date)
    }

    /// Quick add just saved `task` on the screen on top.
    func reuseAdded(_ task: TaskItem) {
        reused = (tab, currentRoute, task)
    }

    private func forgetAddedElsewhere() {
        guard let reused, reused.tab != tab || reused.route != currentRoute else { return }
        self.reused = nil
    }

    /// Opens the details of the task quick add saved, with its card floating over them.
    func openAdded(_ taskID: String) {
        sheet = nil
        sheet = .details(taskID: taskID)
        added = taskID
    }

    private func keepsAdded(from old: Sheet?) -> Bool {
        guard let added, sheet == .details(taskID: added) else { return false }
        switch old {
        case .quickAdd: return true
        case let .details(taskID): return taskID == added
        default: return false
        }
    }

    /// The task just added from Ramble. Its list scrolls to it and the row flashes, then this clears.
    private(set) var revealed: String?

    /// Shows the list a new task lands in and flashes its row.
    func reveal(_ task: TaskItem, labels: [Label], today: DateKey, in zone: TimeZone) {
        if let route = destination(of: task, labels: labels, today: today, in: zone) { open(route) }
        flash(task.id)
    }

    /// The list a new task lands in when the open one doesn't show it. Nil when the open list shows it.
    func destination(of task: TaskItem, labels: [Label], today: DateKey, in zone: TimeZone) -> Route? {
        Screens.added(currentRoute?.screen, task, labels, today, in: zone).map(Route.init)
    }

    /// Scrolls the open list to the task and flashes its row.
    func flash(_ taskID: String) {
        revealed = taskID
        Task {
            try? await Task.sleep(for: .seconds(1.5))
            if revealed == taskID { revealed = nil }
        }
    }

    /// Drops a route that is gone from every tab's stack. Its pin stays, hidden, and when its tab is open the first
    /// other pin opens.
    func drop(_ route: Route) {
        for (tab, path) in paths where path.contains(route) {
            paths[tab] = path.filter { $0 != route }
        }
        guard let pin = pins.first(where: { $0.route == route }), tab == .pin(pin) else { return }
        tab = pins.first { $0 != pin }.map(AppTab.pin) ?? .browse
    }

    func showSearch(query: String = "") {
        sheet = nil
        paths[.browse] = []
        tab = .browse
        searchQuery = query
        focusSearch = true
    }

    /// Follows a `procrastimate://` link from a widget, a control, or another app such as Notouroboros. A task this
    /// device does not have yet waits for sync (`tasksChanged`). A list the catalog no longer has opens nothing; quick
    /// add and Ramble then open with no context.
    func open(_ link: AppLink, in store: Store, today: DateKey) {
        func list(_ key: String?) -> WidgetList? {
            guard let key else { return nil }
            if key == WidgetList.today.key { return .today }
            return store.listCatalog(today: today).lazy.flatMap(\.entries).map(Pin.init).first { $0.key == key }.map(WidgetList.pin)
        }
        awaitedTask = nil
        switch link {
        case let .task(id):
            guard store.task(id) != nil else {
                awaitedTask = (id, clock.now.addingTimeInterval(60))
                return
            }
            openTask(id)
        case let .list(key):
            guard let list = list(key) else { return }
            sheet = nil
            open(list.route)
        case let .add(key):
            sheet = .quickAdd(store.quickAddDefaults(list(key)?.screen(today: today)))
        case let .ramble(key):
            sheet = .ramble(store.quickAddDefaults(list(key)?.screen(today: today)))
        }
    }

    func tasksChanged(in store: Store) {
        guard let awaited = awaitedTask, store.task(awaited.id) != nil else { return }
        awaitedTask = nil
        if clock.now < awaited.until { openTask(awaited.id) }
    }

    /// Opens what a share link points at in a space this user is already a member of, instead of the read-only
    /// page. Returns false when it is not theirs to open.
    func openShared(_ target: API.ShareTarget, in store: Store) -> Bool {
        switch target.kind {
        case .project where store.project(target.id) != nil:
            sheet = nil
            open(.project(id: target.id))
        case .label where store.label(target.id) != nil:
            sheet = nil
            open(.label(id: target.id))
        case .task where store.task(target.id) != nil:
            sheet = .details(taskID: target.id)
        default:
            return false
        }
        return true
    }
}
