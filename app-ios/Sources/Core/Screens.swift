import Foundation

/// A list screen, from `shared/screens.ts`. A project screen names a section, and Inbox a day, when quick add opens
/// from that section's or day's heading.
public enum ListScreen: Hashable, Sendable {
    case inbox(date: DateKey? = nil)
    case tomorrow
    case thisWeek(date: DateKey? = nil)
    case noDate
    case completed
    case project(id: String, sectionId: String? = nil)
    case label(id: String)
    case place(key: String)
    case event(id: String)
}

/// Ports `shared/screens.ts`.
public enum Screens {
    /// Whether a new task may land on `screen`'s project or label. `access` is the rows of the space someone shared
    /// with this user, nil on the user's own lists, which always take one, as does every other screen. The server
    /// admits a new task only through an edit share on the list or on the whole space, and writes `edit` on the list's
    /// row exactly then, so the list takes one when its row says so.
    public static func canAdd(to screen: ListScreen?, _ access: [Access]?) -> Bool {
        guard let access else { return true }
        let list: (kind: API.AccessKind, id: String)
        switch screen {
        case let .project(id, _)?: list = (.project, id)
        case let .label(id)?: list = (.label, id)
        default: return true
        }
        return access.contains { $0.kind == list.kind && $0.entityId == list.id && $0.role == .edit }
    }

    /// Quick add inherits the screen it opens from, so the new task lands on that screen: its project and section, its
    /// label, its place, its event, or the day of a day heading. Tomorrow starts tomorrow and This week today, the one
    /// day the week always holds. Inbox itself adds an undated task, as capture always has, and so do No date,
    /// Completed, and a shared project or label the user can't add to (`canAdd`).
    public static func defaults(
        _ screen: ListScreen?,
        _ tasks: [TaskItem],
        _ access: [Access]?,
        today: DateKey
    ) -> QuickAddDraft.Defaults {
        guard canAdd(to: screen, access) else { return QuickAddDraft.Defaults() }
        return switch screen {
        case nil, .noDate?, .completed?:
            QuickAddDraft.Defaults()
        case let .inbox(date)?:
            QuickAddDraft.Defaults(date: date)
        case .tomorrow?:
            QuickAddDraft.Defaults(date: Dates.addDays(today, 1))
        case let .thisWeek(date)?:
            QuickAddDraft.Defaults(date: date ?? today)
        case let .project(id, sectionId)?:
            QuickAddDraft.Defaults(projectId: id, sectionId: sectionId)
        case let .label(id)?:
            QuickAddDraft.Defaults(labelIds: [id])
        case let .place(key)?:
            QuickAddDraft.Defaults(location: earliest(tasks) { $0.location.map(Triggers.placeKey) == key }?.location)
        case let .event(id)?:
            QuickAddDraft.Defaults(event: earliest(tasks) { $0.event?.id == id }?.event)
        }
    }

    /// What quick add reuses after saving `task`, while the list it saved from stays open: where the task went (its
    /// project, section, labels, place, and event), never its date or priority, which belong to one task. A saved place
    /// goes back among the labels, since quick add picks one there.
    public static func reusedDefaults(_ task: TaskItem, _ labels: [Label]) -> QuickAddDraft.Defaults {
        QuickAddDraft.Defaults(
            projectId: task.projectId,
            sectionId: task.sectionId,
            labelIds: Triggers.pickedLabels(labels, task),
            location: task.location,
            event: task.event
        )
    }

    /// Whether `task` shows on `screen`, so saving it from there keeps the screen open.
    public static func holds(_ screen: ListScreen?, _ task: TaskItem, _ today: DateKey, in zone: TimeZone) -> Bool {
        switch screen {
        case nil, .completed?:
            false
        case .inbox?:
            Triggers.scheduledDue(task, today, in: zone) != nil
        case .tomorrow?:
            Triggers.scheduledDue(task, today, in: zone)?.date == Dates.addDays(today, 1)
        case .thisWeek?:
            Triggers.scheduledDue(task, today, in: zone).map { $0.date <= Views.weekEnd(today) } ?? false
        case .noDate?:
            task.projectId == nil && task.parentId == nil && Triggers.scheduledDue(task, today, in: zone) == nil
        case let .project(id, _)?:
            task.projectId == id
        case let .label(id)?:
            task.labelIds.contains(id)
        case let .place(key)?:
            task.location.map(Triggers.placeKey) == key
        case let .event(id)?:
            task.event?.id == id
        }
    }

    /// The earliest open task's copy, the one a place's or event's name comes from. Once every task there is done, the
    /// screen can stay open, so the latest done task's copy keeps quick add on it.
    private static func earliest(_ tasks: [TaskItem], _ match: (TaskItem) -> Bool) -> TaskItem? {
        let matching = tasks.filter(match)
        return matching.filter { $0.completedAt == nil }.min { $0.createdAt < $1.createdAt }
            ?? matching.max { ($0.completedAt ?? 0) < ($1.completedAt ?? 0) }
    }
}
