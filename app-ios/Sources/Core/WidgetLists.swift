import Foundation

/// What the home and lock screen widgets read. The app writes it into the shared app group after every change, and the
/// widget extension, which has no database, computes each list from it with the same rules the screens use, so a
/// widget rolls over at midnight without the app running.
public struct WidgetData: Codable, Sendable, Equatable {
    public var signedIn: Bool
    /// The user's own open tasks, plus the ones completed today, which the progress ring counts.
    public var tasks: [TaskItem]
    public var projects: [Project]
    public var labels: [Label]
    /// The theme color's raw value, since the extension cannot read the app's `UserDefaults`.
    public var accent: String?

    public init(signedIn: Bool, tasks: [TaskItem] = [], projects: [Project] = [], labels: [Label] = [], accent: String? = nil) {
        self.signedIn = signedIn
        self.tasks = tasks
        self.projects = projects
        self.labels = labels
        self.accent = accent
    }

    /// Keeps only what a widget can show, so the file stays small however long the completed history grows.
    public static func make(
        signedIn: Bool,
        tasks: [TaskItem],
        projects: [Project],
        labels: [Label],
        accent: String?,
        today: DateKey,
        in zone: TimeZone
    ) -> WidgetData {
        let doneToday = Set(Views.completedTasks(tasks, Views.CompletedRange(from: today, to: today), in: zone).map(\.id))
        return WidgetData(
            signedIn: signedIn,
            tasks: tasks.filter { $0.completedAt == nil || doneToday.contains($0.id) },
            projects: StoreRules.projectsInOrder(projects),
            labels: labels,
            accent: accent
        )
    }
}

/// A list a widget shows: Today, which no screen has on its own, or any top-level list from the catalog.
public enum WidgetList: Hashable, Sendable {
    case today
    case pin(Pin)

    /// A stable id for a widget's configuration, the pin's key for a catalog list.
    public var key: String {
        switch self {
        case .today: "today"
        case let .pin(pin): pin.key
        }
    }

    /// The screen quick add inherits from, so a task added from the widget lands on its list. Today adds a task due
    /// today, as Inbox's Today heading does.
    public func screen(today: DateKey) -> ListScreen {
        switch self {
        case .today: .inbox(date: today)
        case .pin(.inbox): .inbox(date: nil)
        case .pin(.tomorrow): .tomorrow
        case .pin(.thisWeek): .thisWeek(date: nil)
        case .pin(.noDate): .noDate
        case let .pin(.project(id)): .project(id: id)
        case let .pin(.label(id)): .label(id: id)
        case let .pin(.place(key, _)): .place(key: key)
        case let .pin(.event(id, _)): .event(id: id)
        }
    }
}

public enum WidgetLists {
    public struct Choice: Hashable, Sendable {
        public let list: WidgetList
        public let name: String
        /// The catalog group it comes from, such as `Projects`, for the configuration picker's subtitle.
        public let group: String
    }

    /// What a widget draws for one list at one moment.
    public struct Listing: Equatable, Sendable {
        public let name: String
        /// Open tasks in the order the list's screen shows them.
        public let tasks: [TaskItem]
        public let overdue: Int
        /// Tasks on this list completed today.
        public let done: Int

        /// How far through today's list Stefan is, from 0 to 1. An empty list with nothing done is not progress.
        public init(name: String, tasks: [TaskItem], overdue: Int, done: Int) {
            self.name = name
            self.tasks = tasks
            self.overdue = overdue
            self.done = done
        }

        public var progress: Double {
            let total = tasks.count + done
            return total == 0 ? 0 : Double(done) / Double(total)
        }
    }

    /// Today first, then every list of the user's own from the catalog. Shared lists are left out: the widget data
    /// holds only the user's own space.
    public static func choices(_ data: WidgetData, today: DateKey, in zone: TimeZone) -> [Choice] {
        let open = data.tasks.filter { $0.completedAt == nil }
        let groups = Lists.catalog(own: (open, data.projects, data.labels), shared: [], today: today, in: zone)
        return [Choice(list: .today, name: "Today", group: "Lists")]
            + groups.flatMap { group in group.entries.map { Choice(list: .pin(Pin($0)), name: $0.name, group: group.title) } }
    }

    /// The choice a stored configuration names, nil once its project, label, place, or event is gone.
    public static func choice(key: String, in data: WidgetData, today: DateKey, in zone: TimeZone) -> Choice? {
        choices(data, today: today, in: zone).first { $0.list.key == key }
    }

    public static func listing(_ choice: Choice, _ data: WidgetData, today: DateKey, in zone: TimeZone) -> Listing {
        let open = data.tasks.filter { $0.completedAt == nil }
        let tasks: [TaskItem]
        var overdue = 0
        func dated(_ list: Views.DueList) -> [TaskItem] {
            let due = Views.dueDays(open, today, list, in: zone)
            overdue = due.overdue.count
            return due.overdue + due.today + due.days.flatMap(\.tasks)
        }
        switch choice.list {
        case .today:
            let due = Views.todayTasks(open, today, in: zone)
            overdue = due.overdue.count
            tasks = due.overdue + due.today
        case .pin(.inbox): tasks = dated(.inbox)
        case .pin(.tomorrow): tasks = dated(.tomorrow)
        case .pin(.thisWeek): tasks = dated(.thisWeek)
        case .pin(.noDate):
            tasks = Views.noDateTasks(open, today, newestFirst: true, in: zone)
        case let .pin(.project(id)):
            tasks = Views.projectTasks(open, id, in: zone)
        case let .pin(.label(id)):
            tasks = data.labels.first { $0.id == id }.map { Views.labelViewTasks(open, $0, in: zone) } ?? []
        case let .pin(.place(key, _)):
            tasks = Views.placeTasks(open, key, in: zone)
        case let .pin(.event(id, _)):
            tasks = Views.eventTasks(open, id, today, in: zone)
        }
        let completed = Views.completedTasks(data.tasks, Views.CompletedRange(from: today, to: today), in: zone)
        // A saved place's label lives on its tasks as a location, never in `labelIds`, so its done tasks are the place's.
        var screen = choice.list.screen(today: today)
        if case let .pin(.label(id)) = choice.list, let place = data.labels.first(where: { $0.id == id })?.place {
            screen = .place(key: Triggers.placeKey(place))
        }
        let done = choice.list == .today
            ? completed.count
            : completed.filter { Screens.holds(screen, $0, today, in: zone) }.count
        return Listing(name: choice.name, tasks: tasks, overdue: overdue, done: done)
    }

    /// The moments after `now` when a list changes without any edit: each of the next `days` midnights, when today's
    /// tasks turn overdue and tomorrow's become today's.
    public static func rollovers(after now: Date, days: Int, in zone: TimeZone) -> [Date] {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        let start = calendar.startOfDay(for: now)
        return (1...days).compactMap { calendar.date(byAdding: .day, value: $0, to: start) }
    }
}
