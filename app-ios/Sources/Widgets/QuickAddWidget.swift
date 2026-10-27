import AppIntents
import Core
import SwiftUI
import WidgetKit

struct QuickAddEntry: TimelineEntry {
    let date: Date
    /// The list's key, nil for plain capture into Inbox.
    let list: String?
    let name: String
    let symbol: String
    let action: QuickAddAction
    let accent: AccentColors
}

/// Nothing on it changes with time, so one entry lasts until the app reloads it.
struct QuickAddProvider: AppIntentTimelineProvider {
    func placeholder(in _: Context) -> QuickAddEntry {
        QuickAddEntry(date: Date(), list: nil, name: "Inbox", symbol: Pin.inbox.systemImage, action: .add, accent: AccentColors(.preset(Accents.defaultAccent)))
    }

    func snapshot(for configuration: QuickAddConfiguration, in _: Context) async -> QuickAddEntry { entry(configuration) }

    func timeline(for configuration: QuickAddConfiguration, in _: Context) async -> Timeline<QuickAddEntry> {
        Timeline(entries: [entry(configuration)], policy: .never)
    }

    private func entry(_ configuration: QuickAddConfiguration) -> QuickAddEntry {
        let accent = AccentColors(Accents.parseAccent(WidgetStore.read()?.accent))
        let list = configuration.list
        return QuickAddEntry(
            date: Date(),
            list: list?.id,
            name: list?.name ?? "Inbox",
            symbol: list?.symbol ?? Pin.inbox.systemImage,
            action: configuration.action,
            accent: accent
        )
    }
}

struct QuickAddWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: "quickAdd", intent: QuickAddConfiguration.self, provider: QuickAddProvider()) { entry in
            QuickAddView(entry: entry)
                .containerBackground(for: .widget) { WidgetCanvas(accent: entry.accent) }
        }
        .configurationDisplayName("Quick Add")
        .description("Add a task, or say a few, straight into a list.")
        .supportedFamilies([.systemSmall, .accessoryCircular])
    }
}

private struct QuickAddView: View {
    @Environment(\.widgetFamily) private var family
    let entry: QuickAddEntry

    var body: some View {
        if family == .accessoryCircular {
            ZStack {
                AccessoryWidgetBackground()
                Image(systemName: entry.action == .add ? "plus" : "waveform")
                    .font(.system(size: 22, weight: .semibold))
                    .widgetAccentable()
            }
            .widgetURL(entry.action == .add ? AppLink.add(list: entry.list).url : AppLink.ramble(list: entry.list).url)
            .accessibilityLabel(entry.action == .add ? "Add task to \(entry.name)" : "Ramble into \(entry.name)")
        } else {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 5) {
                    Image(systemName: entry.symbol)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(entry.accent.tint)
                        .widgetAccentable()
                    Text(entry.name).font(.caption.weight(.semibold)).foregroundStyle(.muted).lineLimit(1)
                }
                Spacer(minLength: 0)
                Button(intent: OpenAppLinkIntent(link: AppLink.add(list: entry.list).url)) {
                    Label("Add task", systemImage: "plus")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(entry.accent.onTint)
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .background(entry.accent.tint, in: .capsule)
                        .widgetAccentable()
                }
                .buttonStyle(.plain)
                Button(intent: OpenAppLinkIntent(link: AppLink.ramble(list: entry.list).url)) {
                    Label("Ramble", systemImage: "waveform")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.ink)
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .background(.fillControl, in: .capsule)
                        .overlay { Capsule().strokeBorder(.glassEdge) }
                }
                .buttonStyle(.plain)
            }
        }
    }
}

struct AddTaskControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        AppIntentControlConfiguration(kind: "addTaskControl", intent: AddTaskControlConfiguration.self) { configuration in
            ControlWidgetButton(action: OpenAppLinkIntent(link: AppLink.add(list: configuration.list?.id).url)) {
                Label(configuration.list.map { "Add to \($0.name)" } ?? "Add Task", systemImage: "plus.circle")
            }
        }
        .displayName("Add Task")
        .description("Opens quick add on a list.")
    }
}

struct RambleControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "rambleControl") {
            ControlWidgetButton(action: OpenAppLinkIntent(link: AppLink.ramble(list: nil).url)) {
                Label("Ramble", systemImage: "waveform")
            }
        }
        .displayName("Ramble")
        .description("Starts listening for tasks.")
    }
}
