import Foundation

/// A list screen, from `shared/screens.ts`. A project screen names a section, and Inbox a day, when quick add opens
/// from that section's or day's heading.
public enum ListScreen: Hashable, Sendable {
    case inbox(date: DateKey? = nil)
    case noDate
    case completed
    case project(id: String, sectionId: String? = nil)
    case label(id: String)
    case place(key: String)
    case event(id: String)
}

/// Ports `shared/screens.ts`.
public enum Screens {
    /// Whether a new task may land on `screen`'s project or label, in a space someone shared with this user through
    /// `grants`. The user's own lists (nil grants), and every other screen, always take one. In a shared space the server
    /// only admits a new task an edit share reaches, so the list takes one when the user can edit the whole space or
    /// that project or label.
    public static func canAdd(to screen: ListScreen?, _ grants: [API.SpaceGrant]?) -> Bool {
        guard let grants else { return true }
        let list: (kind: API.ShareTargetKind, id: String)
        switch screen {
        case let .project(id, _)?: list = (.project, id)
        case let .label(id)?: list = (.label, id)
        default: return true
        }
        return grants.contains { $0.role == .edit && ($0.kind == .space || ($0.kind == list.kind && $0.id == list.id)) }
    }

    /// Quick add inherits the screen it opens from, so the new task lands on that screen: its project and section, its
    /// label, its place, its event, or the day of an Inbox heading. Inbox itself adds an undated task, as capture
    /// always has, and so do No date, Completed, and a shared project or label the user can't add to (`canAdd`).
    public static func defaults(_ screen: ListScreen?, _ tasks: [TaskItem], _ grants: [API.SpaceGrant]?) -> QuickAddDraft.Defaults {
        guard canAdd(to: screen, grants) else { return QuickAddDraft.Defaults() }
        return switch screen {
        case nil, .noDate?, .completed?:
            QuickAddDraft.Defaults()
        case let .inbox(date)?:
            QuickAddDraft.Defaults(date: date)
        case let .project(id, sectionId)?:
            QuickAddDraft.Defaults(projectId: id, sectionId: sectionId)
        case let .label(id)?:
            QuickAddDraft.Defaults(labelId: id)
        case let .place(key)?:
            QuickAddDraft.Defaults(location: earliest(tasks) { $0.location.map(Triggers.placeKey) == key }?.location)
        case let .event(id)?:
            QuickAddDraft.Defaults(event: earliest(tasks) { $0.event?.id == id }?.event)
        }
    }

    /// Whether `task` shows on `screen`, so saving it from there keeps the screen open.
    public static func holds(_ screen: ListScreen?, _ task: TaskItem, _ today: DateKey, in zone: TimeZone) -> Bool {
        switch screen {
        case nil, .completed?:
            false
        case .inbox?:
            Triggers.scheduledDue(task, today, in: zone) != nil
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
