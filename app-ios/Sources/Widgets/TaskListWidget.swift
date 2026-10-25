import Core
import SwiftUI
import WidgetKit

struct TaskListWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(
            kind: "tasks",
            intent: TaskListConfiguration.self,
            provider: ListProvider<TaskListConfiguration>(showsAdd: { $0.showsAdd })
        ) { entry in
            TaskListView(entry: entry)
                .containerBackground(for: .widget) { WidgetCanvas(accent: entry.accent) }
        }
        .configurationDisplayName("Tasks")
        .description("Check off a list's tasks without opening the app.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .systemExtraLarge, .accessoryRectangular, .accessoryInline])
    }
}

struct TaskListView: View {
    @Environment(\.widgetFamily) private var family
    let entry: ListEntry

    var body: some View {
        switch entry.state {
        case .signedOut: SignedOutView(accent: entry.accent)
        case .missing: MissingListView(accent: entry.accent)
        case let .ready(listing, list, symbol):
            switch family {
            case .accessoryInline: InlineView(listing: listing, symbol: symbol)
            case .accessoryRectangular: RectangularView(entry: entry, listing: listing, list: list, symbol: symbol)
            default: HomeView(entry: entry, listing: listing, list: list, symbol: symbol)
            }
        }
    }
}

private struct HomeView: View {
    @Environment(\.widgetFamily) private var family
    let entry: ListEntry
    let listing: WidgetLists.Listing
    let list: WidgetList
    let symbol: String

    var body: some View {
        VStack(alignment: .leading, spacing: compact ? 6 : 8) {
            header
            if listing.tasks.isEmpty {
                EmptyListView(listing: listing, accent: entry.accent)
            } else {
                VStack(alignment: .leading, spacing: compact ? 6 : 9) {
                    ForEach(listing.tasks.prefix(limit), id: \.id) { task in
                        TaskRowView(
                            task: task,
                            today: entry.today,
                            project: showsProject ? task.projectId.flatMap { entry.projects[$0] } : nil,
                            compact: compact
                        )
                        .transition(.push(from: .bottom).combined(with: .opacity))
                    }
                }
                Spacer(minLength: 0)
                if listing.tasks.count > limit {
                    Text("+\(listing.tasks.count - limit) more")
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(.faint)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .widgetURL(AppLink.list(key: list.key).url)
    }

    private var header: some View {
        HStack(spacing: 6) {
            Link(destination: AppLink.list(key: list.key).url) {
                HStack(spacing: 5) {
                    Image(systemName: symbol)
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(entry.accent.tint)
                        .widgetAccentable()
                    Text(listing.name)
                        .font(compact ? .subheadline.weight(.semibold) : .headline)
                        .foregroundStyle(.ink)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 4)
            Text("\(listing.tasks.count)")
                .font(.subheadline.weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(listing.overdue > 0 ? .toneOverdue : .muted)
                .contentTransition(.numericText(value: Double(listing.tasks.count)))
                .accessibilityLabel("\(listing.tasks.count) open")
            if entry.showsAdd {
                AddButton(link: .add(list: list.key), accent: entry.accent, size: compact ? 24 : 28)
            }
        }
    }

    private var compact: Bool { family == .systemSmall }

    private var limit: Int {
        switch family {
        case .systemSmall: 3
        case .systemMedium: 3
        case .systemLarge: 8
        default: 9
        }
    }

    private var showsProject: Bool {
        if case .pin(.project) = list { false } else { !compact }
    }
}

struct TaskRowView: View {
    let task: TaskItem
    let today: DateKey
    let project: String?
    let compact: Bool

    var body: some View {
        HStack(alignment: .center, spacing: compact ? 7 : 10) {
            Button(intent: CompleteWidgetTaskIntent(taskID: task.id)) {
                WidgetCheckbox(tone: task.priority.tone, size: compact ? 17 : 20)
                    .frame(width: compact ? 22 : 28, height: compact ? 22 : 28)
                    .contentShape(.circle)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Complete \(task.title)")
            Link(destination: AppLink.task(id: task.id).url) {
                VStack(alignment: .leading, spacing: 1) {
                    Text(task.title)
                        .font(compact ? .caption : .subheadline)
                        .foregroundStyle(.ink)
                        .lineLimit(1)
                    if !compact, let detail {
                        detail.font(.caption2).lineLimit(1)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .invalidatableContent()
    }

    private var detail: Text? {
        let due = Triggers.scheduledDue(task, today, in: .current)
        var parts: [Text] = []
        if let due {
            parts.append(Text(Format.formatDue(due, today)).foregroundStyle(Format.dueTone(due, today).color))
        }
        if let project { parts.append(Text(project).foregroundStyle(.faint)) }
        guard let first = parts.first else { return nil }
        return parts.dropFirst().reduce(first) { Text("\($0)\(Text(" · ").foregroundStyle(.faint))\($1)") }
    }
}

private struct EmptyListView: View {
    let listing: WidgetLists.Listing
    let accent: API.AccentChoice

    var body: some View {
        VStack(spacing: 4) {
            Image(systemName: listing.done > 0 ? "checkmark.seal.fill" : "sparkles")
                .font(.system(size: 28, weight: .semibold))
                .foregroundStyle(accent.tint)
                .widgetAccentable()
            Text(listing.done > 0 ? "All done" : "Nothing here")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.ink)
            Text(listing.done > 0 ? "\(listing.done) completed today" : "Enjoy the quiet")
                .font(.caption)
                .foregroundStyle(.muted)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct RectangularView: View {
    let entry: ListEntry
    let listing: WidgetLists.Listing
    let list: WidgetList
    let symbol: String

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            HStack(spacing: 4) {
                Image(systemName: symbol).font(.caption.weight(.bold))
                Text(listing.name).font(.headline).lineLimit(1)
                Spacer(minLength: 2)
                Text("\(listing.tasks.count)").font(.headline).monospacedDigit()
                    .contentTransition(.numericText(value: Double(listing.tasks.count)))
            }
            .widgetAccentable()
            if listing.tasks.isEmpty {
                Text(listing.done > 0 ? "All done · \(listing.done) today" : "Nothing here").font(.caption)
            } else {
                ForEach(listing.tasks.prefix(2), id: \.id) { task in
                    HStack(spacing: 5) {
                        Button(intent: CompleteWidgetTaskIntent(taskID: task.id)) {
                            Image(systemName: "circle").font(.caption.weight(.semibold))
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Complete \(task.title)")
                        Text(task.title).font(.caption).lineLimit(1)
                    }
                    .invalidatableContent()
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .widgetURL(AppLink.list(key: list.key).url)
    }
}

private struct InlineView: View {
    let listing: WidgetLists.Listing
    let symbol: String

    var body: some View {
        if let next = listing.tasks.first {
            Label("\(listing.tasks.count) · \(next.title)", systemImage: symbol)
        } else {
            Label(listing.done > 0 ? "\(listing.name) done" : "\(listing.name) clear", systemImage: "checkmark.circle")
        }
    }
}
