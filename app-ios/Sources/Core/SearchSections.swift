/// How the search sheet lays out `Search.Results`, like the web's `Search.svelte`: Projects, Labels, Tasks, and
/// Completed, each with its best few rows and the full count in its header, skipping empty groups.
public enum SearchSections {
    public static let limits = (projects: 5, labels: 5, open: 30, completed: 15)

    public enum Row: Hashable, Sendable, Identifiable {
        case project(Search.NameHit<Project>)
        case label(Search.NameHit<Label>)
        case task(Search.TaskHit)

        public var id: String {
            switch self {
            case let .project(hit): "p-\(hit.item.id)"
            case let .label(hit): "l-\(hit.item.id)"
            case let .task(hit): "t-\(hit.task.id)"
            }
        }
    }

    public struct Section: Hashable, Sendable, Identifiable {
        public var title: String
        public var total: Int
        public var rows: [Row]

        public var id: String { title }
    }

    public static func sections(_ results: Search.Results) -> [Section] {
        [
            Section(
                title: "Projects",
                total: results.projects.count,
                rows: results.projects.prefix(limits.projects).map(Row.project)
            ),
            Section(title: "Labels", total: results.labels.count, rows: results.labels.prefix(limits.labels).map(Row.label)),
            Section(title: "Tasks", total: results.open.count, rows: results.open.prefix(limits.open).map(Row.task)),
            Section(
                title: "Completed",
                total: results.completed.count,
                rows: results.completed.prefix(limits.completed).map(Row.task)
            ),
        ]
        .filter { !$0.rows.isEmpty }
    }
}
