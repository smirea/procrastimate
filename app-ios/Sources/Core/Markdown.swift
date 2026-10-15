import Foundation

/// The Markdown copy of `shared/markdown.ts`. Event times resolve in `zone`.
public enum Markdown {
    public typealias Document = API.MarkdownDocument
    public typealias Section = API.MarkdownSection
    public typealias Context = API.MarkdownContext

    /// A project view's copy: its loose tasks, then each section under its name.
    public static func projectDocument(_ project: Project, _ groups: [Views.ProjectGroup]) -> Document {
        Document(
            title: project.name,
            projectId: project.id,
            sections: groups.map { Section(heading: $0.section?.name, tasks: $0.tasks) }
        )
    }

    /// A copy as a Markdown checklist. Each task carries its subtasks nested under it, done ones checked, so a subtask
    /// whose ancestor is also in the copy shows only there.
    public static func toMarkdown(_ document: Document, _ context: Context, in zone: TimeZone) -> String {
        let children = Subtasks.groupChildren(context.tasks)
        let projects = Dictionary(context.projects.map { ($0.id, $0.name) }, uniquingKeysWith: { first, _ in first })
        let labels = Dictionary(context.labels.map { ($0.id, $0.name) }, uniquingKeysWith: { first, _ in first })
        let byId = Dictionary(context.tasks.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        let copied = Set(document.sections.flatMap { $0.tasks.map(\.id) })

        func nested(_ task: TaskItem) -> Bool {
            var id = task.parentId
            while let current = id {
                if copied.contains(current) { return true }
                id = byId[current]?.parentId
            }
            return false
        }

        func line(_ task: TaskItem) -> String {
            let due = Triggers.scheduledDue(task, context.today, in: zone)
            let project = task.parentId == nil && task.projectId != document.projectId
                ? projects[task.projectId ?? ""]
                : nil
            let parts: [String?] = [
                task.title,
                due.map { Format.formatDue($0, context.today) },
                task.recurrence.map { Format.formatRecurrence($0, due) },
                task.priority < .p4 ? "p\(task.priority.rawValue)" : nil,
                project.map { "#\($0)" },
            ] + task.labelIds.map { labels[$0].map { "@\($0)" } }
            return parts.compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
        }

        func item(_ task: TaskItem, _ depth: Int) -> [String] {
            let indent = String(repeating: "  ", count: depth)
            let trimmed = task.notes.trimmingCharacters(in: .whitespacesAndNewlines)
            let notes = trimmed.isEmpty
                ? []
                : trimmed.split(omittingEmptySubsequences: false, whereSeparator: \.isNewline).map { note in
                    String("\(indent)  \(note)".trimmingSuffix(while: \.isWhitespace))
                }
            return ["\(indent)- [\(task.completedAt == nil ? " " : "x")] \(line(task))"]
                + notes
                + (children[task.id] ?? []).flatMap { item($0, depth + 1) }
        }

        var blocks: [String] = []
        if let title = document.title { blocks.append("# \(title)") }
        for section in document.sections {
            let list = section.tasks.filter { !nested($0) }.flatMap { item($0, 0) }
            if list.isEmpty { continue }
            if let heading = section.heading { blocks.append("## \(heading)") }
            blocks.append(list.joined(separator: "\n"))
        }
        return blocks.joined(separator: "\n\n")
    }
}

private extension String {
    func trimmingSuffix(while predicate: (Character) -> Bool) -> Substring {
        var end = endIndex
        while end > startIndex, predicate(self[index(before: end)]) { end = index(before: end) }
        return self[..<end]
    }
}
