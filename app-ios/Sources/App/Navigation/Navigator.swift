import Core
import Foundation
import Observation

@MainActor @Observable
final class Navigator {
    /// Coming to Browse from another tab starts a fresh search, like the web's search sheet. Back from a result keeps
    /// the query, because that never leaves Browse.
    var tab: AppTab {
        didSet { if tab != oldValue, tab == .browse { searchQuery = "" } }
    }
    /// The tab bar's screens before Browse, in order. Kept per device, since how many fit depends on the screen.
    private(set) var pins: [Pin]
    var searchQuery = ""
    var paths: [AppTab: [Route]] = [:]
    var sheet: Sheet?
    /// Asks Browse to focus its search field, as Cmd-K does. Browse clears it once focused.
    var focusSearch = false

    static let pinsKey = "procrastimate-pins"

    init() {
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

    /// Quick add from the tab bar starts with the context of the screen on top, as `Screens.defaults` maps it.
    func listDefaults(_ tasks: [TaskItem]) -> QuickAddDefaults {
        Screens.defaults(currentRoute?.screen, tasks)
    }

    /// The task just added from quick add. Its list scrolls to it and the row flashes, then this clears.
    private(set) var revealed: String?

    /// Shows the list a new task lands in: the open list when it already shows the task, else its project, else Inbox
    /// when it has a day or No date when it has none.
    func reveal(_ task: TaskItem, today: DateKey, in zone: TimeZone) {
        if !Screens.holds(currentRoute?.screen, task, today, in: zone) {
            if let projectId = task.projectId {
                open(.project(id: projectId))
            } else {
                open(Triggers.scheduledDue(task, today, in: zone) == nil ? .noDate : .inbox)
            }
        }
        revealed = task.id
        Task {
            try? await Task.sleep(for: .seconds(1.5))
            if revealed == task.id { revealed = nil }
        }
    }

    /// Swaps a route in every tab's stack and in the pins, or drops it from the stacks when `next` is nil. A pin with
    /// no `next` stays, hidden, and its tab moves to the first other pin.
    func replace(_ route: Route, with next: Route?) {
        for (tab, path) in paths where path.contains(route) {
            paths[tab] = path.compactMap { $0 == route ? next : $0 }
        }
        guard let pin = pins.first(where: { $0.route == route }) else { return }
        let survivor: Pin? = switch next {
        case let .project(id)?: .project(id: id)
        case let .label(id)?: .label(id: id)
        default: nil
        }
        let wasOpen = tab == .pin(pin)
        let updated = pins.following(pin, to: survivor)
        setPins(updated)
        guard wasOpen else { return }
        if let survivor, updated.contains(survivor) {
            tab = .pin(survivor)
        } else {
            tab = updated.first { $0 != pin }.map(AppTab.pin) ?? .browse
        }
    }

    func showSearch(query: String = "") {
        sheet = nil
        paths[.browse] = []
        tab = .browse
        searchQuery = query
        focusSearch = true
    }

    /// The task a `procrastimate://task/<id>` link names, such as one from Notouroboros.
    static func taskID(in url: URL) -> String? {
        guard url.scheme == "procrastimate", url.host() == "task", url.pathComponents.count == 2 else { return nil }
        return url.pathComponents[1]
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
