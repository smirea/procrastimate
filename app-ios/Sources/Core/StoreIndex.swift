/// Lookups over every space, rebuilt once per snapshot change, so a row reads a dictionary instead of scanning every
/// task and comment on every change. Entity ids are UUIDs, so one map over all kinds finds a space.
struct StoreIndex {
    private(set) var tasks: [String: TaskItem] = [:]
    private(set) var projects: [String: Project] = [:]
    private(set) var sections: [String: ProjectSection] = [:]
    private(set) var labels: [String: Label] = [:]
    /// Each parent's subtasks in sibling order.
    private(set) var children: [String: [TaskItem]] = [:]
    /// Each task's comments, oldest first.
    private(set) var comments: [String: [Comment]] = [:]
    private(set) var spaces: [String: SpaceKey] = [:]
    /// Every shared entity's owner, for `SpaceRouting`.
    private(set) var homes: SpaceRouting.Homes = [:]
    private(set) var allTasks: [TaskItem] = []
    private(set) var allProjects: [Project] = []
    private(set) var allLabels: [Label] = []
    private(set) var allSections: [ProjectSection] = []
    private(set) var allComments: [Comment] = []

    init() {}

    init(own: Snapshot, shared: [String: Snapshot]) {
        add(own, in: .own)
        for owner in shared.keys.sorted() {
            add(shared[owner]!, in: .shared(owner))
        }
        children = Subtasks.groupChildren(allTasks)
        comments = Dictionary(grouping: allComments, by: \.taskId).mapValues { Comments.commentsOn($0, $0[0].taskId) }
    }

    private mutating func add(_ data: Snapshot, in space: SpaceKey) {
        for task in data.tasks {
            tasks[task.id] = task
            spaces[task.id] = space
        }
        for project in data.projects {
            projects[project.id] = project
            spaces[project.id] = space
        }
        for section in data.sections {
            sections[section.id] = section
            spaces[section.id] = space
        }
        for label in data.labels {
            labels[label.id] = label
            spaces[label.id] = space
        }
        if case let .shared(owner) = space {
            for id in data.tasks.map(\.id) + data.projects.map(\.id) + data.sections.map(\.id) + data.labels.map(\.id) {
                homes[id] = owner
            }
        }
        allTasks += data.tasks
        allProjects += data.projects
        allLabels += data.labels
        allSections += data.sections
        allComments += data.comments
    }
}
