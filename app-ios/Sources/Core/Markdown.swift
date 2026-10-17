import Foundation

/// The Markdown copy of `shared/markdown.ts`.
public enum Markdown {
    public typealias Document = API.MarkdownDocument
    public typealias Section = API.MarkdownSection

    /// A project view's copy: its loose tasks, then each section under its name.
    public static func projectDocument(_ project: Project, _ groups: [Views.ProjectGroup]) -> Document {
        Document(title: project.name, sections: groups.map { Section(heading: $0.section?.name, tasks: $0.tasks) })
    }

    /// A copy as a plain nested list, for a person or an AI to get the gist: each task's title, then its notes and its
    /// subtasks nested under it, with no checkboxes, dates, or tags. A notes line that is already a list item keeps its
    /// marker. `tasks` is every task, so a subtask whose ancestor is also in the copy shows only there.
    public static func toMarkdown(_ document: Document, _ tasks: [TaskItem]) -> String {
        let children = Subtasks.groupChildren(tasks)
        let byId = Dictionary(tasks.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        let copied = Set(document.sections.flatMap { $0.tasks.map(\.id) })

        func nested(_ task: TaskItem) -> Bool {
            var id = task.parentId
            while let current = id {
                if copied.contains(current) { return true }
                id = byId[current]?.parentId
            }
            return false
        }

        func item(_ task: TaskItem, _ depth: Int) -> [String] {
            let indent = String(repeating: "  ", count: depth)
            let notes = task.notes.components(separatedBy: "\n").compactMap { raw -> String? in
                let line = raw.hasSuffix("\r") ? String(raw.dropLast()) : raw
                let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
                if trimmed.isEmpty { return nil }
                return "\(indent)  " + (isListItem(trimmed) ? String(line.trimmingSuffix(while: \.isWhitespace)) : "- \(trimmed)")
            }
            return ["\(indent)- \(task.title.trimmingCharacters(in: .whitespacesAndNewlines))"]
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

    /// `- `, `* `, `+ `, `1. `, or `1) `, as `LIST_ITEM` in the TypeScript.
    private static func isListItem(_ line: String) -> Bool {
        line.firstMatch(of: /^([-*+]|\d+[.)])\s/) != nil
    }
}

private extension String {
    func trimmingSuffix(while predicate: (Character) -> Bool) -> Substring {
        var end = endIndex
        while end > startIndex, predicate(self[index(before: end)]) { end = index(before: end) }
        return self[..<end]
    }
}
