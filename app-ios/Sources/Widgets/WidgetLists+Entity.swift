import AppIntents
import Core
import Foundation

/// A list a widget or control shows or adds to, picked from the lists in the app group file.
struct WidgetListEntity: AppEntity {
    static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "List")
    static let defaultQuery = WidgetListQuery()
    static let today = WidgetListEntity(id: WidgetList.today.key, name: "Today", group: "Lists", symbol: "sun.max")

    let id: String
    let name: String
    let group: String
    let symbol: String

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(name)", subtitle: "\(group)", image: DisplayRepresentation.Image(systemName: symbol))
    }
}

struct WidgetListQuery: EntityQuery {
    func entities(for identifiers: [String]) async throws -> [WidgetListEntity] {
        let all = Self.all()
        return identifiers.compactMap { id in all.first { $0.id == id } }
    }

    func suggestedEntities() async throws -> [WidgetListEntity] { Self.all() }

    func defaultResult() async -> WidgetListEntity? { .today }

    private static func all() -> [WidgetListEntity] {
        let data = WidgetStore.read() ?? WidgetData(signedIn: false)
        let now = WidgetNow()
        return WidgetLists.choices(data, today: now.today, in: now.zone).map { choice in
            WidgetListEntity(id: choice.list.key, name: choice.name, group: choice.group, symbol: choice.symbol(in: data))
        }
    }
}

/// The extension reads the real clock; `Core` takes it as arguments.
struct WidgetNow {
    let date: Date
    let zone: TimeZone

    init(_ date: Date = Date(), zone: TimeZone = .current) {
        self.date = date
        self.zone = zone
    }

    var today: DateKey { Dates.toDateKey(date, in: zone) }
}

extension WidgetLists.Choice {
    func symbol(in data: WidgetData) -> String {
        switch list {
        case .today: WidgetListEntity.today.symbol
        case let .pin(.project(id)): data.projects.first { $0.id == id }?.systemImage ?? "number"
        case let .pin(.label(id)): data.labels.first { $0.id == id }?.systemImage() ?? "tag"
        case let .pin(pin): pin.systemImage
        }
    }
}

struct TaskListConfiguration: WidgetConfigurationIntent {
    static let title: LocalizedStringResource = "Tasks"
    static let description = IntentDescription("A list's open tasks, with checkboxes to complete them.")

    @Parameter(title: "List")
    var list: WidgetListEntity?

    @Parameter(title: "Show Header", default: true)
    var showsHeader: Bool

    @Parameter(title: "Show Add Button", default: true)
    var showsAdd: Bool

    /// The add button sits in the header, so it is a choice only while the header shows.
    static var parameterSummary: some ParameterSummary {
        When(\.$showsHeader, .equalTo, true) {
            Summary {
                \.$list
                \.$showsHeader
                \.$showsAdd
            }
        } otherwise: {
            Summary {
                \.$list
                \.$showsHeader
            }
        }
    }

    init() {}
}

struct ProgressConfiguration: WidgetConfigurationIntent {
    static let title: LocalizedStringResource = "Progress"
    static let description = IntentDescription("How much of a list is done today.")

    @Parameter(title: "List")
    var list: WidgetListEntity?

    init() {}
}

enum QuickAddAction: String, AppEnum {
    case add, ramble

    static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Action")
    static let caseDisplayRepresentations: [QuickAddAction: DisplayRepresentation] = [
        .add: DisplayRepresentation(title: "Add Task", image: .init(systemName: "plus")),
        .ramble: DisplayRepresentation(title: "Ramble", image: .init(systemName: "waveform")),
    ]
}

struct QuickAddConfiguration: WidgetConfigurationIntent {
    static let title: LocalizedStringResource = "Quick Add"
    static let description = IntentDescription("Opens quick add or Ramble on a list.")

    @Parameter(title: "Adds To")
    var list: WidgetListEntity?

    @Parameter(title: "Lock Screen Action", default: .add)
    var action: QuickAddAction

    init() {}
}

struct AddTaskControlConfiguration: ControlConfigurationIntent {
    static let title: LocalizedStringResource = "Add Task"

    @Parameter(title: "Adds To")
    var list: WidgetListEntity?

    init() {}
}
