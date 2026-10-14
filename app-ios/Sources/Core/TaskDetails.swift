import Foundation

/// Task details' rules from `app-web/src/lib/components/TaskDetails.svelte`: the title parses like quick add, the chips
/// show what it will apply before Enter or blur commits it, and a date change keeps or drops the repeat.
public enum TaskDetails {
    /// The fields the chips show: the task's, or what the edited title will apply to it.
    public struct Draft: Hashable, Sendable {
        public var title: String
        public var due: Due?
        public var recurrence: Recurrence?
        public var priority: Priority
        public var projectId: String?
        public var labelIds: [String]
        public var reminders: [Reminder]

        public init(_ task: TaskItem) {
            title = task.title
            due = task.due
            recurrence = task.recurrence
            priority = task.priority
            projectId = task.projectId
            labelIds = task.labelIds
            reminders = task.reminders
        }
    }

    public enum TitleCommit: Hashable, Sendable {
        case unchanged
        /// The edit leaves no title, so the field goes back to the task's.
        case revert
        /// Saves the patch, and the field shows the parsed title.
        case update(TaskPatch, title: String)
    }

    /// A subtask's title never parses `#Name`, since a subtask always shares its root task's project.
    public static func parse(
        _ title: String,
        _ task: TaskItem,
        now: Date,
        projects: [Project],
        labels: [Label],
        in zone: TimeZone
    ) -> QuickAdd.Parsed {
        QuickAdd.parse(
            title,
            QuickAdd.Options(now: now, projects: task.parentId == nil ? projects : [], labels: labels, due: task.due),
            in: zone
        )
    }

    /// Typed values win over the task's, labels and reminders add to its own.
    public static func draft(_ task: TaskItem, title: String, _ parsed: QuickAdd.Parsed) -> Draft {
        var draft = Draft(task)
        guard title != task.title, !parsed.title.isEmpty else { return draft }
        draft.title = parsed.title
        // An event stands in for the date and repeat, so a typed one is ignored on an event task, as on the web.
        draft.due = task.event == nil ? parsed.due ?? task.due : nil
        draft.recurrence = task.event == nil ? parsed.recurrence ?? task.recurrence : nil
        draft.priority = parsed.priority ?? task.priority
        draft.projectId = parsed.projectId ?? task.projectId
        for id in parsed.labelIds where !draft.labelIds.contains(id) { draft.labelIds.append(id) }
        draft.reminders = task.reminders + parsed.reminders
        return draft
    }

    public static func commitTitle(_ task: TaskItem, title: String, _ parsed: QuickAdd.Parsed) -> TitleCommit {
        if title == task.title { return .unchanged }
        if parsed.title.isEmpty { return .revert }
        let draft = draft(task, title: title, parsed)
        let patch = TaskPatch(
            title: draft.title,
            projectId: .some(draft.projectId),
            labelIds: draft.labelIds,
            due: .some(draft.due),
            recurrence: .some(draft.recurrence),
            priority: draft.priority,
            reminders: draft.reminders
        )
        return .update(patch, title: draft.title)
    }

    /// A repeat needs a date to count from, so removing the date removes the repeat.
    public static func setDue(_ task: TaskItem, _ due: Due?) -> TaskPatch {
        TaskPatch(due: .some(due), recurrence: .some(due == nil ? nil : task.recurrence))
    }
}

/// The repeat menu's rules from `RecurrencePicker.svelte`: presets, a custom interval, and a row of weekday toggles,
/// Monday first, that edits a weekly set while the menu stays open.
public enum RepeatMenu {
    public static let presets: [Recurrence] = RecurrenceUnit.allCases.map { Recurrence(interval: 1, unit: $0) }
    public static let units = RecurrenceUnit.allCases
    public static let week: [Weekday] = [1, 2, 3, 4, 5, 6, 0]
    public static let intervals = 1...365

    /// Setting a repeat on an undated task dates it today, so presets read as they will apply.
    public static func anchor(_ due: Due?, today: DateKey) -> Due {
        due ?? Due(date: today, time: nil)
    }

    /// The repeat to store and the due date it starts on: the first occurrence on or after `opened`, the due date the
    /// menu opened with, so toggle order never changes the result. A one-day set is stored as a plain weekly repeat.
    public static func set(_ next: Recurrence?, opened: Due, due: Due?) -> (recurrence: Recurrence?, due: Due?) {
        guard let next else { return (nil, due) }
        let stored = next.unit == .week && next.days != nil ? Dates.weeklyOn(next.interval, next.days!) : next
        return (stored, Due(date: Dates.alignToRecurrence(opened.date, next), time: opened.time))
    }

    /// A plain weekly repeat already repeats on its due weekday. Any other repeat starts with no days.
    public static func weekdays(_ recurrence: Recurrence?, anchor: Due) -> [Weekday] {
        guard let recurrence, recurrence.unit == .week else { return [] }
        return recurrence.days ?? [Dates.weekdayOf(anchor.date)]
    }

    /// The last selected day cannot be turned off, so clearing goes through `Don't repeat`.
    public static func canToggle(_ day: Weekday, _ weekdays: [Weekday]) -> Bool {
        weekdays != [day]
    }

    /// The repeat a weekday toggle asks for. A custom weekly interval keeps its interval.
    public static func toggling(_ day: Weekday, _ recurrence: Recurrence?, anchor: Due) -> Recurrence {
        let current = weekdays(recurrence, anchor: anchor)
        let days = Dates.sortWeekdays(current.contains(day) ? current.filter { $0 != day } : current + [day])
        return Recurrence(interval: recurrence?.unit == .week ? recurrence!.interval : 1, unit: .week, days: days)
    }

    /// A custom weekly interval keeps the current weekday set.
    public static func custom(_ interval: Int, _ unit: RecurrenceUnit, _ recurrence: Recurrence?) -> Recurrence {
        let days = unit == .week && recurrence?.unit == .week ? recurrence?.days : nil
        return Recurrence(interval: interval, unit: unit, days: days)
    }

    /// Whether a preset shows as the current repeat. A weekday set matches none.
    public static func isSelected(_ preset: Recurrence, _ recurrence: Recurrence?) -> Bool {
        guard let recurrence else { return false }
        return recurrence.interval == preset.interval && recurrence.unit == preset.unit
            && !(recurrence.unit == .week && recurrence.days != nil)
    }
}

public enum ReminderMenu {
    /// Minutes before the due time: at due time, 10m, 30m, 1h, and 1d.
    public static let presets = [0, 10, 30, 60, 1440]

    /// Adds a reminder unless the task already has the same one.
    public static func adding(_ reminder: Reminder, to reminders: [Reminder]) -> [Reminder]? {
        reminders.contains(reminder) ? nil : reminders + [reminder]
    }

    /// A reminder at a moment, on the picked date, else the due date, else today.
    public static func at(date: DateKey?, time: TimeOfDay, due: Due?, today: DateKey) -> Reminder {
        .at(date: date ?? due?.date ?? today, time: time)
    }

    /// `1 reminder`, `2 reminders`, or `Add reminder` for the chip's accessible name.
    public static func chipLabel(_ count: Int) -> String {
        count == 0 ? "Add reminder" : "\(count) reminder\(count > 1 ? "s" : "")"
    }

    public static func sectionTitle(_ due: Due?) -> String {
        due?.time == nil ? "Before due time · needs a time" : "Before due time"
    }
}
