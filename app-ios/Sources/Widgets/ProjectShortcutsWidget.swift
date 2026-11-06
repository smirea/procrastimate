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
        .configurationDisplayName("Project Shortcuts")
        .description("Up to four projects, one tap away, each with its count.")
        .supportedFamilies([.systemMedium])
        .promptsForUserConfiguration()
    }
}

/// A project a shortcut opens, picked from the projects in the app group file.
struct WidgetProjectEntity: AppEntity {
    static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Project")
    static let defaultQuery = WidgetProjectQuery()

    let id: String
    let name: String
    let symbol: String

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(name)", image: DisplayRepresentation.Image(systemName: symbol))
    }
}

struct WidgetProjectQuery: EntityQuery {
    func entities(for identifiers: [String]) async throws -> [WidgetProjectEntity] {
        let all = Self.all()
        return identifiers.compactMap { id in all.first { $0.id == id } }
    }

    func suggestedEntities() async throws -> [WidgetProjectEntity] { Self.all() }

    private static func all() -> [WidgetProjectEntity] {
        (WidgetStore.read()?.projects ?? []).map { WidgetProjectEntity(id: $0.id, name: $0.name, symbol: $0.systemImage) }
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

/// App intents take no arrays of structs, so each of the four cells is a project and a counter of its own.
struct ProjectShortcutsConfiguration: WidgetConfigurationIntent {
    static let title: LocalizedStringResource = "Project Shortcuts"
    static let description = IntentDescription("Opens a project from a 2×2 grid, with its due or pending count.")

    @Parameter(title: "Project 1") var project1: WidgetProjectEntity?
    @Parameter(title: "Counter 1", default: .due) var counter1: ShortcutCounter
    @Parameter(title: "Project 2") var project2: WidgetProjectEntity?
    @Parameter(title: "Counter 2", default: .due) var counter2: ShortcutCounter
    @Parameter(title: "Project 3") var project3: WidgetProjectEntity?
    @Parameter(title: "Counter 3", default: .due) var counter3: ShortcutCounter
    @Parameter(title: "Project 4") var project4: WidgetProjectEntity?
    @Parameter(title: "Counter 4", default: .due) var counter4: ShortcutCounter

    var slots: [(project: WidgetProjectEntity?, counter: ShortcutCounter)] {
        [(project1, counter1), (project2, counter2), (project3, counter3), (project4, counter4)]
    }

    init() {}
}

struct ShortcutsEntry: TimelineEntry {
    enum State {
        case signedOut
        /// No project picked, or every picked one is gone.
        case empty
        case ready([WidgetLists.Shortcut])
    }

    let date: Date
    let state: State
    let accent: AccentColors

    static func make(_ configuration: ProjectShortcutsConfiguration, at now: WidgetNow, data: WidgetData?) -> ShortcutsEntry {
        let accent = AccentColors(Accents.parseAccent(data?.accent))
        guard let data, data.signedIn else { return ShortcutsEntry(date: now.date, state: .signedOut, accent: accent) }
        let shortcuts = configuration.slots.compactMap { slot in
            slot.project.flatMap { WidgetLists.shortcut(project: $0.id, counter: slot.counter.counter, data, today: now.today, in: now.zone) }
        }
        return ShortcutsEntry(date: now.date, state: shortcuts.isEmpty ? .empty : .ready(shortcuts), accent: accent)
    }

    static var sample: ShortcutsEntry {
        let projects: [(String, ProjectIcon, Int?, Bool)] = [
            ("Home", .home, 3, true), ("Work", .work, 5, false), ("Groceries", .groceries, 12, false), ("Someday", .someday, nil, false),
        ]
        let shortcuts = projects.enumerated().map { index, project in
            WidgetLists.Shortcut(
                project: Project(id: "\(index)", name: project.0, icon: project.1, createdAt: 0),
                count: project.2,
                overdue: project.3
            )
        }
        return ShortcutsEntry(date: Date(), state: .ready(shortcuts), accent: AccentColors(.preset(Accents.defaultAccent)))
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
                Text("Pick up to four projects").font(.subheadline.weight(.semibold)).foregroundStyle(.ink)
                Text("Touch and hold, then Edit Widget.").font(.caption).foregroundStyle(.muted)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        case let .ready(shortcuts):
            Grid(horizontalSpacing: 8, verticalSpacing: 8) {
                ForEach(Array(stride(from: 0, to: shortcuts.count, by: 2)), id: \.self) { start in
                    GridRow {
                        ForEach(shortcuts[start..<min(start + 2, shortcuts.count)], id: \.project.id) { shortcut in
                            ShortcutCell(shortcut: shortcut, accent: entry.accent)
                                .gridCellColumns(shortcuts.count - start == 1 ? 2 : 1)
                        }
                    }
                }
            }
        }
    }
}

private struct ShortcutCell: View {
    let shortcut: WidgetLists.Shortcut
    let accent: AccentColors

    var body: some View {
        Link(destination: AppLink.list(key: Pin.project(id: shortcut.project.id).key).url) {
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .top) {
                    Image(systemName: shortcut.project.systemImage)
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
                Text(shortcut.project.name)
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
        guard let count = shortcut.count else { return shortcut.project.name }
        return "\(shortcut.project.name), \(count)"
    }
}
