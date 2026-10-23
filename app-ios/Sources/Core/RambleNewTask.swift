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
        let ownProject = task.projectId == nil || task.projectId == defaults?.projectId
        return NewTask(
            title: task.title.trimmingCharacters(in: .whitespacesAndNewlines),
            projectId: task.projectId ?? defaults?.projectId,
            sectionId: ownProject ? defaults?.sectionId : nil,
            labelIds: placed.labelIds,
            due: event == nil ? task.due ?? defaults?.date.map { Due(date: $0, time: nil) } : nil,
            recurrence: event == nil ? task.recurrence : nil,
            priority: task.priority,
            reminders: task.reminders,
            location: placed.location,
            event: event
        )
    }
}
