import Foundation

/// One to-do as the on-device model heard it: the speaker's words, and the items they listed for it.
public struct RambleSplit: Hashable, Sendable {
    public var text: String
    public var subtasks: [String]

    public init(text: String, subtasks: [String] = []) {
        self.text = text
        self.subtasks = subtasks
    }
}

extension Ramble {
    /// The on-device model's instructions, shared by the app and `Evals/RambleModel`. One word changes its greedy
    /// output on several eval cases, so run the eval after any edit.
    public static let splitInstructions = """
    You turn a spoken to-do ramble into to-dos. Copy the speaker's words; never add words they did not say.
    Each to-do is one thing to do. Keep its time words and reminders in its text ("at 2pm", "tomorrow", "remind me 10 minutes before"), \
    even when they come in a later sentence. Drop filler like "um", "so", "and then", "I need to".
    When the speaker lists things that belong inside one to-do (items to buy, things to pack, steps of a project), \
    put each in that to-do's subtasks and leave them out of its text. Separate errands are separate to-dos, not subtasks. \
    "buy salt and pepper" is one to-do with no subtasks.
    If the speaker cancels a to-do ("scratch that", "never mind"), leave it out. Keep other corrections as said ("Thursday, actually Friday").

    Example ramble: Go to the store at 5pm and grab apples, flour and butter. Then I need to call Mia tomorrow, remind me an hour before.
    Answer: [{text: "go to the store at 5pm", subtasks: ["apples", "flour", "butter"]}, {text: "call Mia tomorrow, remind me an hour before", subtasks: []}]
    """

    /// Spoken commands (`next task`, `subtask`, `note`, `scratch that`) are the grammar's to read, so a draft that
    /// uses one skips the model.
    public static func usesCommands(_ draft: RambleDraft) -> Bool {
        draft.tokens.contains { ["separator", "subtask", "note", "correction"].contains($0.kind) }
    }

    /// The model's split turned into tasks, or nil when the transcript does not back it up and the grammar's draft
    /// should stand. The model only picks the structure; every field comes from the grammar reading each piece.
    /// Every piece must come from the transcript. A subtask that only repeats its task's words is dropped, a lone
    /// item is not a list, and a to-do without a list keeps the grammar's own split, because the model often runs two
    /// errands together. The result may not hold more reminders or dates than the grammar found, which catches a
    /// reminder copied into two to-dos, and must keep the grammar's priorities, repeats, projects, labels, and notes.
    /// Every task in the draft must keep half of the words that set it apart from the other tasks, which catches a
    /// dropped one even when it shares a verb with a kept one.
    public static func structured(
        _ split: [RambleSplit],
        transcript: String,
        draft: RambleDraft,
        now: Date,
        projects: [Project] = [],
        labels: [Label] = [],
        in zone: TimeZone
    ) -> [RambleTask]? {
        func parse(_ text: String) -> [RambleTask] {
            Ramble.parse(text, now: now, projects: projects, labels: labels, in: zone).tasks
        }
        let pieces = split
            .map { RambleSplit(text: withoutDanglingReminder($0.text), subtasks: $0.subtasks.filter { !words($0).isEmpty }) }
            .filter { !words($0.text).isEmpty }
        let said = Set(words(transcript))
        func backed(_ piece: String) -> Bool {
            let piece = words(piece)
            return Double(piece.filter(said.contains).count) / Double(piece.count) >= 0.8
        }
        guard !pieces.isEmpty, pieces.allSatisfy({ backed($0.text) && $0.subtasks.allSatisfy(backed) }) else { return nil }

        let tasks = pieces.flatMap { piece -> [RambleTask] in
            let own = Set(words(piece.text))
            let subtasks = piece.subtasks
                .filter { !Set(words($0)).isSubset(of: own) }
                .compactMap { merged(parse($0)) }
            guard subtasks.count >= 2 else { return parse(piece.text) }
            guard var task = merged(parse(piece.text)) else { return [] }
            task.subtasks = subtasks
            return [task]
        }

        let before = draft.tasks.flatMap { [$0] + $0.subtasks }
        let after = tasks.flatMap { [$0] + $0.subtasks }
        func count(_ tasks: [RambleTask], _ has: (RambleTask) -> Bool) -> Int { tasks.filter(has).count }
        guard after.flatMap(\.reminders).count <= before.flatMap(\.reminders).count,
              count(after, { $0.due != nil }) <= count(before, { $0.due != nil }),
              count(after, { $0.priority != nil }) == count(before, { $0.priority != nil }),
              count(after, { $0.recurrence != nil }) == count(before, { $0.recurrence != nil }),
              count(after, { $0.projectId != nil }) == count(before, { $0.projectId != nil }),
              after.flatMap(\.labelIds).count == before.flatMap(\.labelIds).count,
              after.map(\.notes).joined() == before.map(\.notes).joined() else { return nil }
        let out = Set(after.flatMap { words($0.title) })
        let kept = before.indices.allSatisfy { index in
            let others = Set(before.indices.filter { $0 != index }.flatMap { words(before[$0].title) })
            let own = Set(words(before[index].title)).subtracting(glue)
            let distinct = own.subtracting(others)
            let judged = distinct.isEmpty ? own : distinct
            return judged.isEmpty || Double(judged.intersection(out).count) / Double(judged.count) >= 0.5
        }
        return kept && !tasks.isEmpty ? tasks : nil
    }

    /// One piece the grammar read as several tasks becomes one, keeping the first of each field.
    private static func merged(_ parsed: [RambleTask]) -> RambleTask? {
        guard var first = parsed.first else { return nil }
        for more in parsed.dropFirst() {
            first.title += " " + more.title.prefix(1).lowercased() + more.title.dropFirst()
            first.due = first.due ?? more.due
            first.recurrence = first.recurrence ?? more.recurrence
            first.priority = first.priority ?? more.priority
            first.projectId = first.projectId ?? more.projectId
            first.labelIds += more.labelIds.filter { !first.labelIds.contains($0) }
            first.reminders += more.reminders
            first.subtasks += more.subtasks
        }
        return first
    }

    /// The model turns "remind me to call Ben at 5pm" into "call Ben at 5pm, remind me", and the grammar reads a
    /// bare trailing "remind me" as title text.
    private static func withoutDanglingReminder(_ text: String) -> String {
        text.replacingOccurrences(of: #"[\s,;]*\bremind\s+me[\s.!]*$"#, with: "", options: [.regularExpression, .caseInsensitive])
    }

    private static let glue: Set<String> = ["to", "and", "i", "at", "on", "my", "for", "of", "in", "it", "up", "me"]

    private static func words(_ text: String) -> [String] {
        text.lowercased()
            .split(whereSeparator: { !$0.isLetter && !$0.isNumber && $0 != "'" })
            .map(String.init)
            .filter { !["a", "an", "the", "some"].contains($0) }
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
