import Foundation

extension Ramble {
    /// The task to save for a spoken task. List defaults fill only what the speech left empty, as in quick add: the
    /// list's project, and its section while the speech names no other project, its label first, its place, and the day
    /// of an Inbox heading. The list's event stands in for any spoken date or repeat, as a picked event does in quick
    /// add. Subtasks take none, since they live in their parent's project. A saved place among the labels becomes the
    /// task's place, as in quick add.
    public static func newTask(_ task: RambleTask, defaults: QuickAddDraft.Defaults?, labels: [Label]) -> NewTask {
        let labelIds = (defaults?.labelIds.filter { !task.labelIds.contains($0) } ?? []) + task.labelIds
        let placed = Triggers.applyPickedLabels(labels, labelIds, defaults?.location)
        let event = defaults?.event
        let typed = QuickAddMerge.typedOver(
            .init(due: defaults?.date.map { Due(date: $0, time: nil) }, recurrence: nil, priority: nil,
                  projectId: defaults?.projectId, sectionId: defaults?.sectionId),
            .init(due: task.due, recurrence: task.recurrence, priority: task.priority, projectId: task.projectId, sectionId: nil),
            event: event
        )
        return NewTask(
            title: task.title.trimmingCharacters(in: .whitespacesAndNewlines),
            projectId: typed.projectId,
            sectionId: typed.sectionId,
            labelIds: placed.labelIds,
            due: typed.due,
            recurrence: typed.recurrence,
            priority: typed.priority,
            reminders: task.reminders,
            location: placed.location,
            event: event
        )
    }
}
