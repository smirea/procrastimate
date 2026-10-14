import Foundation

/// The on-device model's verdict on one task of the grammar's draft. The model only restructures what the grammar
/// found; dates, priorities, projects, labels, and reminders always come from the grammar, so it never invents them.
public struct RambleReview: Hashable, Sendable {
    public enum Role: String, Hashable, Sendable, CaseIterable {
        case task
        case subtaskOfPrevious
        case partOfPrevious
        case takenBack
    }

    /// The draft task's 1-based number.
    public var number: Int
    public var role: Role
    /// Items the model read inside the task's title, like `milk, eggs and bread`.
    public var items: [String]

    /// The on-device model's instructions, shared by the app and `Evals/RambleModel`.
    public static let instructions = """
    You check how a speech parser split a spoken to-do ramble into numbered draft tasks. For each draft task give:
    role: task if it is its own to-do. subtaskOfPrevious if it is a step or item of the to-do before it. \
    partOfPrevious if it only continues the previous to-do's sentence. takenBack if the speaker cancelled it.
    items: when the task's text lists items or steps inside it (things to buy, steps after "the steps are", \
    "which means", a colon), copy each item exactly. Otherwise empty.

    Example ramble: buy stuff for the party, chips, salsa and soda, and call Dan
    Draft: 1. Buy stuff for the party, chips, salsa and soda  2. Call Dan
    Answer: 1 task items [chips, salsa, soda]; 2 task items []

    Example ramble: clean the house, the steps are vacuum, then mop, then call mom
    Draft: 1. Clean the house, the steps are vacuum  2. Mop  3. Call mom
    Answer: 1 task items [vacuum]; 2 subtaskOfPrevious items []; 3 task items []
    """

    public init(number: Int, role: Role, items: [String] = []) {
        self.number = number
        self.role = role
        self.items = items
    }
}

extension Ramble {
    /// Applies the model's verdicts where the transcript backs them up, and keeps the grammar's tasks otherwise.
    /// An item list becomes subtasks only with two or more items that all appear in the title, set off by a comma or
    /// colon after a lead of two or more words, so `Buy a phone case and a screen protector` stays one task. A task
    /// nests under the one before only when that one already has subtasks and nothing between them ends a sentence
    /// or says `next task`, so a list continues but two plain tasks never merge. The other roles stay unused: on the
    /// eval they turned real tasks into subtasks or dropped them.
    public static func reviewed(_ tasks: [RambleTask], by reviews: [RambleReview], in transcript: String) -> [RambleTask] {
        let units = Array(transcript.utf16)
        var result: [RambleTask] = []
        for (index, task) in tasks.enumerated() {
            let review = reviews.first { $0.number == index + 1 }
            var task = task
            if task.subtasks.isEmpty, let items = review?.items, let split = splitItems(task, items) { task = split }
            if review?.role == .subtaskOfPrevious, var parent = result.last, !parent.subtasks.isEmpty,
               !endsBetween(units, parent.segment.end, task.segment.start) {
                task.projectId = nil
                parent.subtasks.append(contentsOf: [RambleTask(
                    segment: task.segment,
                    title: task.title,
                    notes: task.notes,
                    due: task.due,
                    recurrence: task.recurrence,
                    priority: task.priority,
                    reminders: task.reminders,
                    labelIds: task.labelIds
                )] + task.subtasks)
                parent.segment.end = max(parent.segment.end, task.segment.end)
                result[result.count - 1] = parent
            } else {
                result.append(task)
            }
        }
        return result
    }

    private static func splitItems(_ task: RambleTask, _ items: [String]) -> RambleTask? {
        let found = items
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines.union(.punctuationCharacters)) }
            .filter { !$0.isEmpty }
        let title = task.title
        guard found.count >= 2,
              found.allSatisfy({ title.range(of: $0, options: .caseInsensitive) != nil }),
              let first = title.range(of: found[0], options: .caseInsensitive) else { return nil }
        let lead = String(title[..<first.lowerBound])
        let head = lead.trimmingCharacters(in: .whitespacesAndNewlines.union(.punctuationCharacters))
        guard lead.trimmingCharacters(in: .whitespaces).last.map({ ",:;".contains($0) }) == true,
              head.split(whereSeparator: \.isWhitespace).count >= 2 else { return nil }
        var split = task
        split.title = head
        split.subtasks = found.map { RambleTask(segment: task.segment, title: capitalized($0)) }
        return split
    }

    private static let taskEnd = try! NSRegularExpression(
        pattern: #"[.!?]|\b(?:(?:next|new|another)\s+task|next\s+one|another\s+thing)\b"#,
        options: .caseInsensitive
    )

    private static func endsBetween(_ units: [UInt16], _ start: Int, _ end: Int) -> Bool {
        guard start < end, end <= units.count else { return false }
        let gap = String(decoding: units[start ..< end], as: UTF16.self)
        return taskEnd.firstMatch(in: gap, range: NSRange(location: 0, length: (gap as NSString).length)) != nil
    }

    private static func capitalized(_ text: String) -> String {
        text.prefix(1).uppercased() + text.dropFirst()
    }

    /// The task to save for a spoken task. List defaults fill only what the speech left empty, as in quick add: the
    /// list's project, its label first, and today's date in Today. Subtasks take neither, since they live in their
    /// parent's project.
    public static func newTask(_ task: RambleTask, defaults: QuickAddDraft.Defaults?, today: DateKey) -> NewTask {
        var labelIds = task.labelIds
        if let labelId = defaults?.labelId, !labelIds.contains(labelId) { labelIds.insert(labelId, at: 0) }
        return NewTask(
            title: task.title,
            projectId: task.projectId ?? defaults?.projectId,
            labelIds: labelIds,
            due: task.due ?? (defaults?.today == true ? Due(date: today, time: nil) : nil),
            recurrence: task.recurrence,
            priority: task.priority,
            reminders: task.reminders
        )
    }
}
