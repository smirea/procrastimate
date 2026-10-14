import AppIntents

enum TaskListKind: String, AppEnum {
    case inbox, browse

    static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "List")

    static var caseDisplayRepresentations: [TaskListKind: DisplayRepresentation] {
        [
            .inbox: "Inbox",
            .browse: "Browse",
        ]
    }

    var tab: AppTab {
        switch self {
        case .inbox: .inbox
        case .browse: .browse
        }
    }

    var name: String {
        switch self {
        case .inbox: "Inbox"
        case .browse: "Browse"
        }
    }
}

struct StartRambleIntent: AppIntent {
    static let title: LocalizedStringResource = "Start Ramble"
    static let description = IntentDescription("Opens Ramble and starts listening.")
    static let openAppWhenRun = true

    func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: IntentDialog(stringLiteral: await IntentEffects.startRamble()))
    }
}

struct OpenViewIntent: AppIntent {
    static let title: LocalizedStringResource = "Open List"
    static let description = IntentDescription("Opens Inbox or Browse.")
    static let openAppWhenRun = true

    @Parameter(title: "List")
    var list: TaskListKind

    static var parameterSummary: some ParameterSummary {
        Summary("Open \(\.$list)")
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let dialog = await IntentEffects.open(tab: list.tab, name: list.name)
        return .result(dialog: IntentDialog(stringLiteral: dialog))
    }
}

struct OpenProjectIntent: AppIntent {
    static let title: LocalizedStringResource = "Open Project"
    static let description = IntentDescription("Opens a project.")
    static let openAppWhenRun = true

    @Parameter(title: "Project", requestValueDialog: "Which project?")
    var project: ProjectEntity

    static var parameterSummary: some ParameterSummary {
        Summary("Open \(\.$project)")
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: IntentDialog(stringLiteral: await IntentEffects.open(project: project)))
    }
}

struct OpenTaskIntent: OpenIntent {
    static let title: LocalizedStringResource = "Open Task"
    static let description = IntentDescription("Opens a task.")
    static let openAppWhenRun = true

    @Parameter(title: "Task", requestValueDialog: "Which task?")
    var target: TaskEntity

    static var parameterSummary: some ParameterSummary {
        Summary("Open \(\.$target)")
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: IntentDialog(stringLiteral: await IntentEffects.open(task: target)))
    }
}
