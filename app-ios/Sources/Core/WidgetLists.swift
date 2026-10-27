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
    /// Rows just checked off in a widget, as they were drawn, so the widget shows them struck through in place before
    /// they leave. Optional so a file an older build wrote still reads before the app rewrites it.
    public var checked: [Checked]?

    /// A task checked off in a widget `at` a moment.
    public struct Checked: Codable, Sendable, Equatable {
        public var task: TaskItem
        public var at: Date

        public init(task: TaskItem, at: Date) {
            self.task = task
            self.at = at
        }
    }

    public init(
        signedIn: Bool,
        tasks: [TaskItem] = [],
        projects: [Project] = [],
        labels: [Label] = [],
        accent: String? = nil,
        checked: [Checked]? = nil
    ) {
        self.signedIn = signedIn
        self.tasks = tasks
        self.projects = projects
        self.labels = labels
        self.accent = accent
        self.checked = checked
    }

    /// Keeps only what a widget can show, so the file stays small however long the completed history grows.
    public static func make(
        signedIn: Bool,
        tasks: [TaskItem],
        projects: [Project],
        labels: [Label],
        accent: String?,
        checked: [Checked] = [],
        now: Date,
        today: DateKey,
        in zone: TimeZone
    ) -> WidgetData {
        let doneToday = Set(Views.completedTasks(tasks, Views.CompletedRange(from: today, to: today), in: zone).map(\.id))
        let checked = checked.filter { WidgetLists.isFresh($0, now: now) }
        return WidgetData(
            signedIn: signedIn,
            // An untitled task is quick add's draft open in details, which deletes it if it closes still untitled.
            tasks: tasks.filter { !$0.title.isEmpty && ($0.completedAt == nil || doneToday.contains($0.id)) },
            projects: StoreRules.projectsInOrder(projects),
            labels: labels,
            accent: accent,
            checked: checked.isEmpty ? nil : checked
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
        /// The rows to draw: the open tasks with the ones just checked off still in their places.
        public let rows: [TaskItem]
        /// The ids of the rows just checked off, drawn struck through.
        public let checked: Set<String>
        public let overdue: Int
        /// Tasks on this list completed today.
        public let done: Int

        public init(name: String, tasks: [TaskItem], rows: [TaskItem]? = nil, checked: Set<String> = [], overdue: Int, done: Int) {
            self.name = name
            self.tasks = tasks
            self.rows = rows ?? tasks
            self.checked = checked
            self.overdue = overdue
            self.done = done
        }

        /// How far through today's list Stefan is, from 0 to 1. An empty list with nothing done is not progress.

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

    /// The list at `now`. With `showsChecked`, a row checked off moments ago sorts in as it was drawn, which also hides
    /// a repeating task's next occurrence until the checked row leaves.
    public static func listing(
        _ choice: Choice,
        _ data: WidgetData,
        now: Date,
        showsChecked: Bool = false,
        today: DateKey,
        in zone: TimeZone
    ) -> Listing {
        let checked = showsChecked ? (data.checked ?? []).filter { isFresh($0, now: now) }.map(\.task) : []
        let checkedIds = Set(checked.map(\.id))
        let open = data.tasks.filter { $0.completedAt == nil && !checkedIds.contains($0.id) } + checked
        let rows: [TaskItem]
        var overdue = 0
        func countOverdue(_ tasks: [TaskItem]) -> Int { tasks.count { !checkedIds.contains($0.id) } }
        func dated(_ list: Views.DueList) -> [TaskItem] {
            let due = Views.dueDays(open, today, list, in: zone)
            overdue = countOverdue(due.overdue)
            return due.overdue + due.today + due.days.flatMap(\.tasks)
        }
        switch choice.list {
        case .today:
            let due = Views.todayTasks(open, today, in: zone)
            overdue = countOverdue(due.overdue)
            rows = due.overdue + due.today
        case .pin(.inbox): rows = dated(.inbox)
        case .pin(.tomorrow): rows = dated(.tomorrow)
        case .pin(.thisWeek): rows = dated(.thisWeek)
        case .pin(.noDate):
            rows = Views.noDateTasks(open, today, newestFirst: true, in: zone)
        case let .pin(.project(id)):
            rows = Views.projectTasks(open, id, in: zone)
        case let .pin(.label(id)):
            rows = data.labels.first { $0.id == id }.map { Views.labelViewTasks(open, $0, in: zone) } ?? []
        case let .pin(.place(key, _)):
            rows = Views.placeTasks(open, key, in: zone)
        case let .pin(.event(id, _)):
            rows = Views.eventTasks(open, id, today, in: zone)
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
        return Listing(
            name: choice.name,
            tasks: rows.filter { !checkedIds.contains($0.id) },
            rows: rows,
            checked: checkedIds.intersection(rows.map(\.id)),
            overdue: overdue,
            done: done
        )
    }

    /// How long a checked row stays struck through, counted from the redraw that first shows it. The app may take
    /// seconds to run the intent and the system to redraw, so a window counted from the tap could close unseen.
    public static let checkedFor: TimeInterval = 1.5

    /// How long after the tap a checked row may still first show. Each reload shows it again, so this stays short.
    static let checkedFresh: TimeInterval = 8

    static func isFresh(_ checked: WidgetData.Checked, now: Date) -> Bool {
        checked.at > now.addingTimeInterval(-checkedFresh)
    }

    /// The moments after `now` when a widget redraws without an edit: once the struck rows have shown for
    /// `checkedFor`, then at each of the next `days` midnights. Only the first entry shows checked rows.
    public static func redraws(after now: Date, _ data: WidgetData, days: Int, in zone: TimeZone) -> [Date] {
        let leaving = (data.checked ?? []).contains { isFresh($0, now: now) } ? [now.addingTimeInterval(checkedFor)] : []
        return leaving + rollovers(after: now, days: days, in: zone)
    }

    /// A row's title as plain text: a Markdown link reads as its label, since a row opens its task rather than a link.
    public static func title(_ title: String) -> String {
        Links.linkify(title).map(\.text).joined()
    }

    /// The shortest due date that still says when: the time alone for today when it has one, else the day without the
    /// time, as `Today`, `Tmrw`, `Yest.`, a weekday within the week ahead, or `Oct 21`.
    public static func due(_ due: Due, _ today: DateKey) -> String {
        if due.date == today { return due.time.map(Format.formatTime) ?? "Today" }
        if due.date == Dates.addDays(today, 1) { return "Tmrw" }
        if due.date == Dates.addDays(today, -1) { return "Yest." }
        if due.date > today, due.date < Dates.addDays(today, 7) { return Format.weekdayNames[Dates.weekdayOf(due.date)] }
        return Format.shortDate(due.date, today)
    }

    /// The moments after `now` when a list changes without any edit: each of the next `days` midnights, when today's
    /// tasks turn overdue and tomorrow's become today's.
    static func rollovers(after now: Date, days: Int, in zone: TimeZone) -> [Date] {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        let start = calendar.startOfDay(for: now)
        return (1...days).compactMap { calendar.date(byAdding: .day, value: $0, to: start) }
    }
}
