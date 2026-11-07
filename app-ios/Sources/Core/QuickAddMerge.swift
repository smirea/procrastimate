import Foundation

/// Ports `shared/quick-add-merge.ts`.
public enum QuickAddMerge {
    /// The fields a typed phrase can set over a picked or stored value. A stored task always has a priority; a ramble
    /// may not.
    public struct Placed: Hashable, Sendable {
        public var due: Due?
        public var recurrence: Recurrence?
        public var priority: Priority?
        public var projectId: String?
        public var sectionId: String?

        public init(due: Due?, recurrence: Recurrence?, priority: Priority?, projectId: String?, sectionId: String?) {
            self.due = due
            self.recurrence = recurrence
            self.priority = priority
            self.projectId = projectId
            self.sectionId = sectionId
        }
    }

    /// Typed values win over the base's, as quick add, task details, and a ramble all read a title. A typed project
    /// other than the base's leaves the base's section behind, and an event stands in for the date and the repeat.
    public static func typedOver(_ base: Placed, _ typed: Placed, event: TaskEvent?) -> Placed {
        let projectId = typed.projectId ?? base.projectId
        return Placed(
            due: event == nil ? typed.due ?? base.due : nil,
            recurrence: event == nil ? typed.recurrence ?? base.recurrence : nil,
            priority: typed.priority ?? base.priority,
            projectId: projectId,
            sectionId: typed.sectionId ?? (projectId == base.projectId ? base.sectionId : nil)
        )
    }
}

extension QuickAddMerge.Placed {
    public init(_ parsed: QuickAdd.Parsed) {
        self.init(
            due: parsed.due, recurrence: parsed.recurrence, priority: parsed.priority, projectId: parsed.projectId,
            sectionId: parsed.sectionId
        )
    }
}
