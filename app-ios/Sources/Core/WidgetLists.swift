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
    /// they leave. The widget extension adds them; the app only carries them over. Optional so a file without any
    /// still reads.
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
        let checked = checked.filter { WidgetLists.isStruck($0, now: now) }
        let open = Set(Triggers.openTasks(tasks).map(\.id))
        return WidgetData(
            signedIn: signedIn,
            // An untitled task is quick add's draft open in details, which deletes it if it closes still untitled.
            tasks: tasks.filter { !$0.title.isEmpty && (open.contains($0.id) || doneToday.contains($0.id)) },
            projects: StoreRules.projectsInOrder(projects),
            labels: labels,
            accent: accent,
            checked: checked.isEmpty ? nil : checked
        )
    }

    /// A widget row's checkbox, applied to the widgets' own copy: the task completes, or rolls to its next occurrence,
    /// as the app's store will complete it, and its row as drawn shows struck through until `checkedFor` after `now`.
    /// Nil when the task is no longer open here.
    public func checking(_ id: String, now: Date, today: DateKey, in zone: TimeZone) -> WidgetData? {
        guard let task = tasks.first(where: { $0.id == id && $0.completedAt == nil }),
              let completion = Subtasks.completeTask(tasks, id, today: today, now: Int(now.timeIntervalSince1970 * 1000), in: zone)
        else { return nil }
        var next = self
        next.tasks = tasks.put(completion.changed)
        let struck = (checked ?? []).filter { $0.task.id != id && WidgetLists.isStruck($0, now: now) }
        next.checked = struck + [Checked(task: task, at: now)]
        return next
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

        public init(list: WidgetList, name: String, group: String) {
            self.list = list
            self.name = name
            self.group = group
        }
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
        /// Where the overdue and today rows end and later ones begin, when the list has both.
        public let later: Later?

        public init(
            name: String,
            tasks: [TaskItem],
            rows: [TaskItem]? = nil,
            checked: Set<String> = [],
            overdue: Int,
            done: Int,
            later: Later? = nil
        ) {
            self.name = name
            self.tasks = tasks
            self.rows = rows ?? tasks
            self.checked = checked
            self.overdue = overdue
            self.done = done
            self.later = later
        }

        /// What a widget with room for `limit` rows draws: those rows, with the divider squeezed in between them when a
        /// later row is among them.
        public func slots(limit: Int) -> [Slot] {
            let shown = rows.prefix(limit).map(Slot.task)
            guard let later, later.index < shown.count else { return shown }
            return Array(shown[..<later.index]) + [.later(later.label)] + shown[later.index...]
        }

        /// How far through today's list Stefan is, from 0 to 1. An empty list with nothing done is not progress.
        public var progress: Double {
            let total = tasks.count + done
            return total == 0 ? 0 : Double(done) / Double(total)
        }
    }

    /// The first later row's position in `rows`, and its day as Upcoming heads it: `Tomorrow`, `Saturday`, `Tue, Nov 17`.
    public struct Later: Equatable, Sendable {
        public let index: Int
        public let label: String
    }

    public enum Slot: Equatable, Sendable {
        case task(TaskItem)
        case later(String)

        public var task: TaskItem? {
            if case let .task(task) = self { task } else { nil }
        }
    }

    /// Today first, then every list of the user's own from the catalog. Shared lists are left out: the widget data
    /// holds only the user's own space.
    public static func choices(_ data: WidgetData, today: DateKey, in zone: TimeZone) -> [Choice] {
        let open = Triggers.openTasks(data.tasks)
        let groups = Lists.catalog(own: (open, data.projects, data.labels), shared: [], today: today, in: zone)
        return [Choice(list: .today, name: "Today", group: "Lists")]
            + groups.flatMap { group in group.entries.map { Choice(list: .pin(Pin($0)), name: $0.name, group: group.title) } }
    }

    /// The choice a stored configuration names, nil once its project, label, place, or event is gone.
    public static func choice(key: String, in data: WidgetData, today: DateKey, in zone: TimeZone) -> Choice? {
        choices(data, today: today, in: zone).first { $0.list.key == key }
    }

    /// The list at `now`. A row checked off moments ago sorts in as it was drawn, which also hides a repeating task's
    /// next occurrence until the checked row leaves.
    public static func listing(
        _ choice: Choice,
        _ data: WidgetData,
        now: Date,
        today: DateKey,
        in zone: TimeZone
    ) -> Listing {
        let checked = (data.checked ?? []).filter { isStruck($0, now: now) }.map(\.task)
        let checkedIds = Set(checked.map(\.id))
        let open = Triggers.openTasks(data.tasks.filter { !checkedIds.contains($0.id) } + checked)
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
        let done = choice.list == .today
            ? completed.count
            : completed.filter { holds(choice.list, $0, data, today: today, in: zone) }.count
        return Listing(
            name: choice.name,
            tasks: rows.filter { !checkedIds.contains($0.id) },
            rows: rows,
            checked: checkedIds.intersection(rows.map(\.id)),
            overdue: overdue,
            done: done,
            later: later(rows, today: today, in: zone)
        )
    }

    /// Only a list that opens with overdue or today rows and goes on to a dated later one gets the divider.
    static func later(_ rows: [TaskItem], today: DateKey, in zone: TimeZone) -> Later? {
        let dates = rows.map { Triggers.scheduledDue($0, today, in: zone)?.date }
        guard let index = dates.firstIndex(where: { $0.map { $0 > today } ?? true }), index > 0,
              let date = dates[index]
        else { return nil }
        return Later(index: index, label: Format.dayHeading(date, today))
    }

    /// The number a Shortcuts cell shows next to its list.
    public enum Counter: String, Sendable, CaseIterable {
        case none
        /// The list's overdue and today's tasks, as Today counts them.
        case due
        /// Every open task the list's screen shows.
        case pending
    }

    /// One Shortcuts cell.
    public struct Shortcut: Equatable, Sendable {
        public let choice: Choice
        /// Nil when the counter is off.
        public let count: Int?
        /// Whether any of the counted tasks is overdue, which tones the count.
        public let overdue: Bool

        public init(choice: Choice, count: Int?, overdue: Bool) {
            self.choice = choice
            self.count = count
            self.overdue = overdue
        }
    }

    /// The cell for a list.
    public static func shortcut(_ choice: Choice, counter: Counter, _ data: WidgetData, now: Date, today: DateKey, in zone: TimeZone) -> Shortcut {
        let open = Triggers.openTasks(data.tasks)
        // Today lists a dated subtask under an undated parent, so Due counts it though a project's own rows do not.
        let due = Views.todayTasks(open.filter { holds(choice.list, $0, data, today: today, in: zone) }, today, in: zone)
        let count: Int? = switch counter {
        case .none: nil
        case .due: due.overdue.count + due.today.count
        case .pending: listing(choice, data, now: now, today: today, in: zone).tasks.count
        }
        return Shortcut(choice: choice, count: count, overdue: counter != .none && !due.overdue.isEmpty)
    }

    /// Whether a task belongs to a list, open or done. A saved place's label lives on its tasks as a location, never in
    /// `labelIds`, so a placed label holds the place's tasks.
    static func holds(_ list: WidgetList, _ task: TaskItem, _ data: WidgetData, today: DateKey, in zone: TimeZone) -> Bool {
        var screen = list.screen(today: today)
        if case let .pin(.label(id)) = list, let place = data.labels.first(where: { $0.id == id })?.place {
            screen = .place(key: Triggers.placeKey(place))
        }
        return Screens.holds(screen, task, today, in: zone)
    }

    /// How long a checked row stays struck through, counted from the tap. The widget extension redraws within a moment
    /// of it, so the window is the time the row shows struck.
    public static let checkedFor: TimeInterval = 1.5

    static func isStruck(_ checked: WidgetData.Checked, now: Date) -> Bool {
        now < checked.at.addingTimeInterval(checkedFor)
    }

    /// The moments after `now` when a widget redraws without an edit: as each struck row leaves, then at each of the
    /// next `days` midnights.
    public static func redraws(after now: Date, _ data: WidgetData, days: Int, in zone: TimeZone) -> [Date] {
        let leaving = Set((data.checked ?? []).filter { isStruck($0, now: now) }.map { $0.at.addingTimeInterval(checkedFor) })
        return leaving.sorted() + rollovers(after: now, days: days, in: zone)
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
