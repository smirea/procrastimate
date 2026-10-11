import AppIntents
import Core

/// Priority as Shortcuts shows it. The stored value stays `Priority`.
enum IntentPriority: String, AppEnum {
    case p1, p2, p3, p4

    static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Priority")

    static var caseDisplayRepresentations: [IntentPriority: DisplayRepresentation] {
        [
            .p1: "Priority 1",
            .p2: "Priority 2",
            .p3: "Priority 3",
            .p4: "Priority 4",
        ]
    }

    var priority: Priority {
        switch self {
        case .p1: .p1
        case .p2: .p2
        case .p3: .p3
        case .p4: .p4
        }
    }
}

struct AddTaskIntent: AppIntent {
    static let title: LocalizedStringResource = "Add Task"
    static let description = IntentDescription(
        "Adds a task. Phrases in the title, such as tomorrow, p1, #Project, @label, and remind me, work like Quick Add."
    )
    static let openAppWhenRun = false

    @Parameter(title: "Title", requestValueDialog: "What's the task?")
    var title: String

    @Parameter(title: "Project")
    var project: ProjectEntity?

    @Parameter(title: "Labels")
    var labels: [LabelEntity]?

    @Parameter(title: "Priority")
    var priority: IntentPriority?

    @Parameter(title: "Due")
    var due: Date?

    @Parameter(title: "Reminder")
    var reminder: Date?

    static var parameterSummary: some ParameterSummary {
        Summary("Add \(\.$title)") {
            \.$project
            \.$labels
            \.$priority
            \.$due
            \.$reminder
        }
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let dialog = await IntentEffects.add(
            text: title,
            project: project,
            labels: labels ?? [],
            priority: priority?.priority,
            due: due,
            reminder: reminder
        )
        return .result(dialog: IntentDialog(stringLiteral: dialog))
    }
}

struct CompleteTaskIntent: AppIntent {
    static let title: LocalizedStringResource = "Complete Task"
    static let description = IntentDescription("Completes an open task.")
    static let openAppWhenRun = false

    @Parameter(title: "Task", requestValueDialog: "Which task?")
    var task: TaskEntity

    static var parameterSummary: some ParameterSummary {
        Summary("Complete \(\.$task)")
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: IntentDialog(stringLiteral: await IntentEffects.complete(task)))
    }
}

struct ReopenTaskIntent: AppIntent {
    static let title: LocalizedStringResource = "Uncomplete Task"
    static let description = IntentDescription("Reopens a completed task.")
    static let openAppWhenRun = false

    @Parameter(title: "Task", requestValueDialog: "Which task?")
    var task: TaskEntity

    static var parameterSummary: some ParameterSummary {
        Summary("Uncomplete \(\.$task)")
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: IntentDialog(stringLiteral: await IntentEffects.reopen(task)))
    }
}

struct SearchTasksIntent: AppIntent {
    static let title: LocalizedStringResource = "Search Tasks"
    static let description = IntentDescription("Finds tasks, projects, and labels, and opens the matches.")
    static let openAppWhenRun = true

    @Parameter(title: "Query", requestValueDialog: "What should I search for?")
    var query: String

    static var parameterSummary: some ParameterSummary {
        Summary("Search \(\.$query)")
    }

    func perform() async throws -> some IntentResult & ReturnsValue<[TaskEntity]> & ProvidesDialog {
        let found = await IntentEffects.search(query: query)
        return .result(value: found.entities, dialog: IntentDialog(stringLiteral: found.dialog))
    }
}

struct ListTodayIntent: AppIntent {
    static let title: LocalizedStringResource = "List Today's Tasks"
    static let description = IntentDescription("Lists tasks due today.")
    static let openAppWhenRun = false

    func perform() async throws -> some IntentResult & ReturnsValue<[TaskEntity]> & ProvidesDialog {
        let found = await IntentEffects.listToday()
        return .result(value: found.entities, dialog: IntentDialog(stringLiteral: found.dialog))
    }
}

struct ListOverdueIntent: AppIntent {
    static let title: LocalizedStringResource = "List Overdue Tasks"
    static let description = IntentDescription("Lists tasks due before today.")
    static let openAppWhenRun = false

    func perform() async throws -> some IntentResult & ReturnsValue<[TaskEntity]> & ProvidesDialog {
        let found = await IntentEffects.listOverdue()
        return .result(value: found.entities, dialog: IntentDialog(stringLiteral: found.dialog))
    }
}
