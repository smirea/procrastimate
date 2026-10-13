import Foundation

/// What one ramble writes into quick add. Mirrors `quickAddFromRamble` in `shared/ramble-fill.ts`.
public struct RambleQuickAdd: Hashable, Sendable {
    public var text: String
    public var due: Due?
    public var recurrence: Recurrence?
    public var priority: Priority?
    public var reminders: [Reminder]
    public var projectId: String?
    public var labelIds: [String]

    public init(
        text: String,
        due: Due? = nil,
        recurrence: Recurrence? = nil,
        priority: Priority? = nil,
        reminders: [Reminder] = [],
        projectId: String? = nil,
        labelIds: [String] = []
    ) {
        self.text = text
        self.due = due
        self.recurrence = recurrence
        self.priority = priority
        self.reminders = reminders
        self.projectId = projectId
        self.labelIds = labelIds
    }
}

extension Ramble {
    /// The grammar's tasks as one quick-add field. One task keeps its title and metadata. Several tasks become one
    /// title, in order, and leave the chips empty: quick add holds a single task. Notes and subtasks stay out.
    public static func quickAdd(from draft: RambleDraft) -> RambleQuickAdd? {
        let tasks = draft.tasks.filter { !$0.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        guard let first = tasks.first else { return nil }
        if tasks.count > 1 {
            return RambleQuickAdd(text: tasks.map { $0.title.trimmingCharacters(in: .whitespacesAndNewlines) }.joined(separator: ". "))
        }
        return RambleQuickAdd(
            text: first.title.trimmingCharacters(in: .whitespacesAndNewlines),
            due: first.due,
            recurrence: first.recurrence,
            priority: first.priority,
            reminders: first.reminders,
            projectId: first.projectId,
            labelIds: first.labelIds
        )
    }
}
