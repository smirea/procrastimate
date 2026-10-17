import Foundation

/// The decisions App Intents apply: how a spoken title becomes a task, which task a name picks, and which tasks
/// Spotlight should list. The intents themselves live in the App target, because App Intents and Spotlight are not
/// available to `Core`.
public enum IntentRules {
    /// What Add Task was given. A value in the text wins; one of these fills only what the text left unset, the same
    /// rule as quick add's chips.
    public struct AddRequest: Equatable, Sendable {
        public var text: String
        public var projectId: String?
        public var labelIds: [String]
        public var priority: Priority?
        public var due: Due?
        public var reminders: [Reminder]

        public init(
            text: String,
            projectId: String? = nil,
            labelIds: [String] = [],
            priority: Priority? = nil,
            due: Due? = nil,
            reminders: [Reminder] = []
        ) {
            self.text = text
            self.projectId = projectId
            self.labelIds = labelIds
            self.priority = priority
            self.due = due
            self.reminders = reminders
        }
    }

    public enum TaskStateChange: Sendable {
        case complete
        case reopen
    }

    /// The task to save, or nil when the title is empty after parsing.
    public static func newTask(
        _ request: AddRequest,
        projects: [Project],
        sections: [ProjectSection] = [],
        labels: [Label],
        now: Date,
        zone: TimeZone
    ) -> NewTask? {
        var draft = QuickAddDraft(defaults: .init())
        draft.setText(request.text)
        draft.picked.projectId = request.projectId
        draft.picked.labelIds = request.labelIds
        draft.picked.priority = request.priority
        draft.picked.due = request.due
        let parsed = draft.parse(now: now, projects: projects, sections: sections, labels: labels, in: zone)
        // The quick-add draft keeps a typed reminder and a picked one. A shortcut field fills the gap only.
        if parsed.reminders.isEmpty { draft.picked.reminders = request.reminders }
        return draft.resolve(parsed)
    }

    /// A Shortcuts date becomes a due date in the clock's zone, time included.
    public static func due(from date: Date, in zone: TimeZone) -> Due {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        let parts = calendar.dateComponents([.year, .month, .day, .hour, .minute], from: date)
        let key = String(format: "%04d-%02d-%02d", parts.year ?? 1970, parts.month ?? 1, parts.day ?? 1)
        let time = String(format: "%02d:%02d", parts.hour ?? 0, parts.minute ?? 0)
        return Due(date: key, time: time)
    }

    /// A Shortcuts date becomes a reminder at that moment.
    public static func reminder(at date: Date, in zone: TimeZone) -> Reminder {
        let due = due(from: date, in: zone)
        return .at(date: due.date, time: due.time ?? "00:00")
    }

    /// Exact title matches, ignoring case and accents. Open tasks come first, newest first; completed tasks follow,
    /// most recently completed first.
    public static func titleMatches(_ tasks: [TaskItem], _ title: String) -> [TaskItem] {
        let query = fold(title)
        guard !query.isEmpty else { return [] }
        return byRecency(tasks.filter { fold($0.title) == query })
    }

    /// Titles that start with `title`, excluding exact matches, in the same order as `titleMatches`.
    public static func prefixMatches(_ tasks: [TaskItem], _ title: String) -> [TaskItem] {
        let query = fold(title)
        guard !query.isEmpty else { return [] }
        return byRecency(tasks.filter { fold($0.title) != query && fold($0.title).hasPrefix(query) })
    }

    /// Tasks a spoken name can mean: the exact title, else a prefix, else the same search the app uses.
    public static func resolved(_ tasks: [TaskItem], query: String, projects: [Project], labels: [Label]) -> [TaskItem] {
        let exact = titleMatches(tasks, query)
        if !exact.isEmpty { return exact }
        let prefix = prefixMatches(tasks, query)
        if !prefix.isEmpty { return prefix }
        return searchTasks(query, tasks, projects: projects, labels: labels)
    }

    /// `resolved`, capped so a picker or a Siri prompt stays short.
    public static func candidates(
        _ tasks: [TaskItem],
        query: String,
        projects: [Project],
        labels: [Label],
        limit: Int = 25
    ) -> [TaskItem] {
        Array(resolved(tasks, query: query, projects: projects, labels: labels).prefix(limit))
    }

    /// Newest open tasks, then recently completed ones, for the Shortcuts picker.
    public static func suggestedTasks(_ tasks: [TaskItem], limit: Int = 25) -> [TaskItem] {
        Array(byRecency(tasks).prefix(limit))
    }

    /// The task Complete or Uncomplete should change. The chosen task wins when it is already in the right state, so a
    /// Shortcuts pick is honored. Otherwise the newest open match, or the most recently completed match, is used, which
    /// is what a spoken title means when the resolver handed back the other one.
    public static func completionTarget(_ change: TaskStateChange, id: String, title: String, in tasks: [TaskItem]) -> TaskItem? {
        if let current = tasks.first(where: { $0.id == id }) {
            switch change {
            case .complete where current.completedAt == nil: return current
            case .reopen where current.completedAt != nil: return current
            case .complete, .reopen: break
            }
        }
        let matches = titleMatches(tasks, title)
        switch change {
        case .complete: return matches.first { $0.completedAt == nil }
        case .reopen: return matches.first { $0.completedAt != nil }
        }
    }

    /// Open tasks, which are the ones Spotlight lists. A completed task leaves the index.
    public static func indexedTasks(_ tasks: [TaskItem]) -> [TaskItem] {
        tasks.filter { $0.completedAt == nil }
    }

    /// Search hits in the app's order: open, then completed.
    public static func searchTasks(_ query: String, _ tasks: [TaskItem], projects: [Project], labels: [Label]) -> [TaskItem] {
        let results = Search.search(query, tasks, projects: projects, labels: labels)
        return results.open.map(\.task) + results.completed.map(\.task)
    }

    /// The item whose name equals `query`, ignoring case and accents.
    public static func named<Item>(_ items: [Item], _ query: String, name: (Item) -> String) -> Item? {
        let folded = fold(query)
        guard !folded.isEmpty else { return nil }
        return items.first { fold(name($0)) == folded }
    }

    /// Exact name, else a prefix, else a substring. Blank queries match nothing.
    public static func rankedNames<Item>(_ items: [Item], _ query: String, name: (Item) -> String) -> [Item] {
        let folded = fold(query)
        guard !folded.isEmpty else { return [] }
        let exact = items.filter { fold(name($0)) == folded }
        if !exact.isEmpty { return exact }
        let prefix = items.filter { fold(name($0)).hasPrefix(folded) }
        if !prefix.isEmpty { return prefix }
        return items.filter { fold(name($0)).contains(folded) }
    }

    private static func byRecency(_ tasks: [TaskItem]) -> [TaskItem] {
        tasks.sorted { lhs, rhs in
            let lhsDone = lhs.completedAt != nil
            let rhsDone = rhs.completedAt != nil
            if lhsDone != rhsDone { return !lhsDone }
            if !lhsDone {
                if lhs.createdAt != rhs.createdAt { return lhs.createdAt > rhs.createdAt }
            } else if lhs.completedAt != rhs.completedAt {
                return (lhs.completedAt ?? 0) > (rhs.completedAt ?? 0)
            }
            return lhs.id > rhs.id
        }
    }

    private static func fold(_ text: String) -> String {
        text.trimmingCharacters(in: .whitespacesAndNewlines)
            .folding(options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "en_US"))
    }
}
