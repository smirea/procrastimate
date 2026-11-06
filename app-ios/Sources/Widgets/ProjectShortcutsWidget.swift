import AppIntents
import Core
import SwiftUI
import WidgetKit

struct ProjectShortcutsWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: "projectShortcuts", intent: ProjectShortcutsConfiguration.self, provider: ShortcutsProvider()) { entry in
            ShortcutsView(entry: entry)
                .containerBackground(for: .widget) { WidgetCanvas(accent: entry.accent) }
        }
        .configurationDisplayName("List Shortcuts")
        .description("Up to four lists, one tap away, each with its count.")
        .supportedFamilies([.systemMedium])
        .promptsForUserConfiguration()
    }
}

/// What a shortcut slot holds: any list the Tasks widget can show, or Empty, which keeps the slot's place blank. Its own
/// type, since `WidgetListEntity`'s query defaults to Today and a slot starts empty.
struct ShortcutListEntity: AppEntity {
    static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "List")
    static let defaultQuery = ShortcutListQuery()
    static let empty = ShortcutListEntity(id: "empty", name: "Empty", group: "Leaves the slot blank", symbol: "square.dashed")

    let id: String
    let name: String
    let group: String
    let symbol: String

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(name)", subtitle: "\(group)", image: DisplayRepresentation.Image(systemName: symbol))
    }
}

struct ShortcutListQuery: EntityQuery {
    func entities(for identifiers: [String]) async throws -> [ShortcutListEntity] {
        let all = Self.all()
        return identifiers.compactMap { id in all.first { $0.id == id } }
    }

    func suggestedEntities() async throws -> [ShortcutListEntity] { Self.all() }

    private static func all() -> [ShortcutListEntity] {
        [.empty] + WidgetListQuery.all().map { ShortcutListEntity(id: $0.id, name: $0.name, group: $0.group, symbol: $0.symbol) }
    }
}

enum ShortcutCounter: String, AppEnum {
    case none, due, pending

    static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Counter")
    static let caseDisplayRepresentations: [ShortcutCounter: DisplayRepresentation] = [
        .none: DisplayRepresentation(title: "None"),
        .due: DisplayRepresentation(title: "Due", subtitle: "Overdue and today"),
        .pending: DisplayRepresentation(title: "Pending", subtitle: "Every open task"),
    ]

    var counter: WidgetLists.Counter { WidgetLists.Counter(rawValue: rawValue)! }
}

/// App intents take no arrays of structs, so each of the four slots is a list and a counter of its own. A list array
/// would get reordering in Edit Widget, but its counters could not follow a list as it moves.
struct ProjectShortcutsConfiguration: WidgetConfigurationIntent {
    static let title: LocalizedStringResource = "List Shortcuts"
    static let description = IntentDescription("Opens a list from a 2×2 grid, with its due or pending count.")

    @Parameter(title: "List 1") var list1: ShortcutListEntity?
    @Parameter(title: "Counter 1", default: .due) var counter1: ShortcutCounter
    @Parameter(title: "List 2") var list2: ShortcutListEntity?
    @Parameter(title: "Counter 2", default: .due) var counter2: ShortcutCounter
    @Parameter(title: "List 3") var list3: ShortcutListEntity?
    @Parameter(title: "Counter 3", default: .due) var counter3: ShortcutCounter
    @Parameter(title: "List 4") var list4: ShortcutListEntity?
    @Parameter(title: "Counter 4", default: .due) var counter4: ShortcutCounter

    var slots: [(list: ShortcutListEntity?, counter: ShortcutCounter)] {
        [(list1, counter1), (list2, counter2), (list3, counter3), (list4, counter4)]
    }

    init() {}
}

struct ShortcutsEntry: TimelineEntry {
    struct Cell {
        let shortcut: WidgetLists.Shortcut
        let symbol: String
    }

    enum State {
        case signedOut
        /// Every slot is empty, or its list is gone.
        case empty
        /// The four slots in reading order, nil where one is empty.
        case ready([Cell?])
    }

    let date: Date
    let state: State
    let accent: AccentColors

    static func make(_ configuration: ProjectShortcutsConfiguration, at now: WidgetNow, data: WidgetData?) -> ShortcutsEntry {
        let accent = AccentColors(Accents.parseAccent(data?.accent))
        guard let data, data.signedIn else { return ShortcutsEntry(date: now.date, state: .signedOut, accent: accent) }
        let choices = WidgetLists.choices(data, today: now.today, in: now.zone)
        let cells = configuration.slots.map { slot -> Cell? in
            guard let key = slot.list?.id, let choice = choices.first(where: { $0.list.key == key }) else { return nil }
            let shortcut = WidgetLists.shortcut(choice, counter: slot.counter.counter, data, now: now.date, today: now.today, in: now.zone)
            return Cell(shortcut: shortcut, symbol: choice.symbol(in: data))
        }
        return ShortcutsEntry(date: now.date, state: cells.allSatisfy { $0 == nil } ? .empty : .ready(cells), accent: accent)
    }

    static var sample: ShortcutsEntry {
        let lists: [(WidgetList, String, String, Int?, Bool)] = [
            (.pin(.inbox), "Inbox", "tray", 3, true), (.today, "Today", "sun.max", 5, false),
            (.pin(.project(id: "work")), "Work", ProjectIcon.work.systemImage, 12, false),
            (.pin(.label(id: "gym")), "Gym", "mappin.and.ellipse", nil, false),
        ]
        let cells = lists.map { list, name, symbol, count, overdue in
            Cell(shortcut: WidgetLists.Shortcut(choice: .init(list: list, name: name, group: ""), count: count, overdue: overdue), symbol: symbol)
        }
        return ShortcutsEntry(date: Date(), state: .ready(cells), accent: AccentColors(.preset(Accents.defaultAccent)))
    }
}

/// One entry now and one at each of the next two midnights, when due counts roll over; the app reloads it after every
/// change.
struct ShortcutsProvider: AppIntentTimelineProvider {
    func placeholder(in _: Context) -> ShortcutsEntry { .sample }

    func snapshot(for configuration: ProjectShortcutsConfiguration, in context: Context) async -> ShortcutsEntry {
        let data = WidgetStore.read()
        if context.isPreview, data?.signedIn != true { return .sample }
        let entry = ShortcutsEntry.make(configuration, at: WidgetNow(), data: data)
        if context.isPreview, case .empty = entry.state { return .sample }
        return entry
    }

    func timeline(for configuration: ProjectShortcutsConfiguration, in _: Context) async -> Timeline<ShortcutsEntry> {
        let data = WidgetStore.read()
        let now = WidgetNow()
        let moments = [now] + WidgetLists.redraws(after: now.date, data ?? WidgetData(signedIn: false), days: 2, in: now.zone)
            .map { WidgetNow($0, zone: now.zone) }
        return Timeline(entries: moments.map { ShortcutsEntry.make(configuration, at: $0, data: data) }, policy: .atEnd)
    }
}

private struct ShortcutsView: View {
    let entry: ShortcutsEntry

    var body: some View {
        switch entry.state {
        case .signedOut: SignedOutView(accent: entry.accent)
        case .empty:
            VStack(alignment: .leading, spacing: 4) {
                Image(systemName: "square.grid.2x2")
                    .font(.title2)
                    .foregroundStyle(entry.accent.tint)
                    .widgetAccentable()
                Text("Pick up to four lists").font(.subheadline.weight(.semibold)).foregroundStyle(.ink)
                Text("Touch and hold, then Edit Widget.").font(.caption).foregroundStyle(.muted)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        case let .ready(cells):
            // An empty slot keeps its place in its row; a row with nothing in it gives its height to the other.
            let rows = [Array(cells[0..<2]), Array(cells[2..<4])].filter { $0.contains { $0 != nil } }
            Grid(horizontalSpacing: 8, verticalSpacing: 8) {
                ForEach(rows.indices, id: \.self) { row in
                    GridRow {
                        ForEach(rows[row].indices, id: \.self) { column in
                            if let cell = rows[row][column] {
                                ShortcutCell(cell: cell, accent: entry.accent)
                            } else {
                                RoundedRectangle(cornerRadius: 14)
                                    .strokeBorder(.glassEdge, style: StrokeStyle(lineWidth: 1, dash: [4, 4]))
                                    .accessibilityHidden(true)
                            }
                        }
                    }
                }
            }
        }
    }
}

private struct ShortcutCell: View {
    let cell: ShortcutsEntry.Cell
    let accent: AccentColors

    private var shortcut: WidgetLists.Shortcut { cell.shortcut }

    var body: some View {
        Link(destination: AppLink.list(key: shortcut.choice.list.key).url) {
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .top) {
                    Image(systemName: cell.symbol)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(accent.tint)
                        .widgetAccentable()
                    Spacer(minLength: 4)
                    if let count = shortcut.count, count > 0 {
                        Text("\(count)")
                            .font(.subheadline.weight(.semibold))
                            .monospacedDigit()
                            .foregroundStyle(shortcut.overdue ? .toneOverdue : .muted)
                            .contentTransition(.numericText(value: Double(count)))
                    }
                }
                Spacer(minLength: 2)
                Text(shortcut.choice.name)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.ink)
                    .lineLimit(1)
            }
            .padding(10)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            .background(.fillControl, in: .rect(cornerRadius: 14))
            .overlay { RoundedRectangle(cornerRadius: 14).strokeBorder(.glassEdge) }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(label)
    }

    private var label: String {
        guard let count = shortcut.count else { return shortcut.choice.name }
        return "\(shortcut.choice.name), \(count)"
    }
}
