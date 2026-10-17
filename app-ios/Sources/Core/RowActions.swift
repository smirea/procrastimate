import Foundation

/// Ports `shared/row-actions.ts`: what a task row offers on every list and client. Complete or Reopen, Postpone while it
/// is open and not on an event, Delete, and Copy as Markdown, which is always offered. A task the user may only view
/// offers only Copy, and so does a repeating task's past completion in Completed (`rolled`), since the task itself is
/// still open.
public struct RowActions: Hashable, Sendable {
    public enum Toggle: String, Hashable, Sendable {
        case complete, reopen
    }

    public let toggle: Toggle?
    public let postpone: Bool
    public let delete: Bool

    public init(_ task: TaskItem, readOnly: Bool, rolled: Bool = false) {
        let editable = !readOnly && !rolled
        let done = task.completedAt != nil
        toggle = editable ? done ? .reopen : .complete : nil
        postpone = editable && !done && task.event == nil
        delete = editable
    }
}
