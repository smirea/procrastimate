import AppIntents
import Core
import WidgetKit

/// A configuration that names one list.
protocol ListConfiguration: WidgetConfigurationIntent {
    var list: WidgetListEntity? { get }
}

extension TaskListConfiguration: ListConfiguration {}
extension ProgressConfiguration: ListConfiguration {}

struct ListEntry: TimelineEntry {
    enum State {
        case signedOut
        /// The project, label, place, or event the widget was set to is gone.
        case missing
        case ready(WidgetLists.Listing, list: WidgetList, symbol: String)
    }

    let date: Date
    /// The day the rows' due dates read against.
    let today: DateKey
    let state: State
    let accent: AccentColors
    /// Each project's name by id, for the rows' detail line.
    var projects: [String: String] = [:]
    var style = Style()

    /// What a Tasks widget's configuration turns off.
    struct Style {
        var showsHeader = true
        var showsAdd = true
    }

    static func make(_ list: WidgetListEntity?, at now: WidgetNow, data: WidgetData?, showsChecked: Bool = false) -> ListEntry {
        let accent = AccentColors(Accents.parseAccent(data?.accent))
        guard let data, data.signedIn else { return ListEntry(date: now.date, today: now.today, state: .signedOut, accent: accent) }
        let key = list?.id ?? WidgetList.today.key
        guard let choice = WidgetLists.choice(key: key, in: data, today: now.today, in: now.zone) else {
            return ListEntry(date: now.date, today: now.today, state: .missing, accent: accent)
        }
        let listing = WidgetLists.listing(choice, data, now: now.date, showsChecked: showsChecked, today: now.today, in: now.zone)
        return ListEntry(
            date: now.date,
            today: now.today,
            state: .ready(listing, list: choice.list, symbol: choice.symbol(in: data)),
            accent: accent,
            projects: Dictionary(uniqueKeysWithValues: data.projects.map { ($0.id, $0.name) })
        )
    }

    /// The gallery's preview, and the placeholder before the first read.
    static var sample: ListEntry {
        let tasks = [
            TaskItem(id: "1", title: "Renew passport", due: Due(date: "2026-01-01"), priority: .p1, createdAt: 0),
            TaskItem(id: "2", title: "Call the plumber", due: Due(date: "2026-01-02", time: "09:30"), priority: .p2, createdAt: 0),
            TaskItem(id: "3", title: "Buy oat milk", due: Due(date: "2026-01-02"), createdAt: 0),
            TaskItem(id: "4", title: "Water the plants", due: Due(date: "2026-01-02"), priority: .p3, createdAt: 0),
            TaskItem(id: "5", title: "Book dentist", due: Due(date: "2026-01-02"), createdAt: 0),
        ]
        let listing = WidgetLists.Listing(name: "Today", tasks: tasks, overdue: 1, done: 3)
        return ListEntry(
            date: Date(),
            today: "2026-01-02",
            state: .ready(listing, list: .today, symbol: WidgetListEntity.today.symbol),
            accent: AccentColors(.preset(Accents.defaultAccent))
        )
    }
}

/// One entry now, with any rows just checked off struck through, one as they leave, and one at each of the next two
/// midnights, then a fresh read. The app reloads the timelines after every change, so these entries only carry the
/// days forward.
struct ListProvider<Configuration: ListConfiguration>: AppIntentTimelineProvider {
    var style: (Configuration) -> ListEntry.Style = { _ in ListEntry.Style() }

    func placeholder(in _: Context) -> ListEntry { .sample }

    func snapshot(for configuration: Configuration, in context: Context) async -> ListEntry {
        let data = WidgetStore.read()
        if context.isPreview, data?.signedIn != true { return .sample }
        return entry(configuration, at: WidgetNow(), data: data)
    }

    func timeline(for configuration: Configuration, in _: Context) async -> Timeline<ListEntry> {
        let data = WidgetStore.read()
        let now = WidgetNow()
        let later = WidgetLists.redraws(after: now.date, data ?? WidgetData(signedIn: false), days: 2, in: now.zone)
        let entries = [entry(configuration, at: now, data: data, showsChecked: true)]
            + later.map { entry(configuration, at: WidgetNow($0, zone: now.zone), data: data) }
        return Timeline(entries: entries, policy: .atEnd)
    }

    private func entry(_ configuration: Configuration, at now: WidgetNow, data: WidgetData?, showsChecked: Bool = false) -> ListEntry {
        var entry = ListEntry.make(configuration.list, at: now, data: data, showsChecked: showsChecked)
        entry.style = style(configuration)
        return entry
    }
}
