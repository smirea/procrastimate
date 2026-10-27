import Core
import SwiftUI
import WidgetKit

struct ProgressWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: "progress", intent: ProgressConfiguration.self, provider: ListProvider<ProgressConfiguration>()) { entry in
            ProgressView(entry: entry)
                .containerBackground(for: .widget) { WidgetCanvas(accent: entry.accent) }
        }
        .configurationDisplayName("Progress")
        .description("A ring that fills as you finish a list today.")
        .supportedFamilies([.systemSmall, .accessoryCircular, .accessoryInline])
    }
}

private struct ProgressView: View {
    @Environment(\.widgetFamily) private var family
    let entry: ListEntry

    var body: some View {
        switch entry.state {
        case .signedOut:
            if family == .systemSmall { SignedOutView(accent: entry.accent) } else { Image(systemName: "person.crop.circle") }
        case .missing:
            if family == .systemSmall { MissingListView(accent: entry.accent) } else { Image(systemName: "questionmark") }
        case let .ready(listing, list, symbol):
            Group {
                switch family {
                case .accessoryCircular:
                    Gauge(value: listing.progress) {
                        Image(systemName: symbol)
                    } currentValueLabel: {
                        Text("\(listing.tasks.count)").contentTransition(.numericText(value: Double(listing.tasks.count)))
                    }
                    .gaugeStyle(.accessoryCircularCapacity)
                    .widgetAccentable()
                case .accessoryInline:
                    Label("\(listing.done) of \(listing.done + listing.tasks.count) done", systemImage: symbol)
                default:
                    SmallProgress(listing: listing, symbol: symbol, accent: entry.accent)
                }
            }
            .widgetURL(AppLink.list(key: list.key).url)
        }
    }
}

private struct SmallProgress: View {
    let listing: WidgetLists.Listing
    let symbol: String
    let accent: AccentColors

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 5) {
                Image(systemName: symbol)
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(accent.tint)
                    .widgetAccentable()
                Text(listing.name).font(.subheadline.weight(.semibold)).foregroundStyle(.ink).lineLimit(1)
            }
            Spacer(minLength: 0)
            HStack {
                Spacer(minLength: 0)
                ZStack {
                    Circle().stroke(accent.tint.opacity(0.16), lineWidth: 9)
                    Circle()
                        .trim(from: 0, to: max(listing.progress, 0.001))
                        .stroke(accent.tint, style: StrokeStyle(lineWidth: 9, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                        .widgetAccentable()
                    VStack(spacing: -2) {
                        (listing.tasks.isEmpty ? Text(Image(systemName: "checkmark")) : Text("\(listing.tasks.count)"))
                            .font(.system(size: 26, weight: .bold, design: .rounded))
                            .foregroundStyle(.ink)
                            .contentTransition(.numericText(value: Double(listing.tasks.count)))
                        Text(listing.tasks.isEmpty ? "done" : "left").font(.caption2).foregroundStyle(.muted)
                    }
                }
                .frame(width: 84, height: 84)
                Spacer(minLength: 0)
            }
            Spacer(minLength: 0)
            Text("\(listing.done) done today")
                .font(.caption2.weight(.medium))
                .foregroundStyle(.faint)
                .frame(maxWidth: .infinity, alignment: .center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
