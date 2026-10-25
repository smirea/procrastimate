import ActivityKit
import SwiftUI
import WidgetKit

/// The app's accent in its dark appearance, since Live Activities sit on a dark background and the extension has no
/// access to the app's asset catalog.
private let accent = Color(red: 1, green: 0x7A / 255, blue: 0x61 / 255)

struct PlaceActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: PlaceActivityAttributes.self) { context in
            LockScreenView(placeName: context.attributes.placeName, titles: context.state.titles)
                .activityBackgroundTint(nil)
                .activitySystemActionForegroundColor(accent)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label(context.attributes.placeName, systemImage: "mappin.circle.fill")
                        .font(.headline)
                        .lineLimit(1)
                        .foregroundStyle(accent)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(Self.count(context.state.titles.count))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    TitleList(titles: context.state.titles, limit: 3)
                }
            } compactLeading: {
                Image(systemName: "mappin.circle.fill").foregroundStyle(accent)
            } compactTrailing: {
                Text("\(context.state.titles.count)")
                    .monospacedDigit()
                    .foregroundStyle(accent)
            } minimal: {
                Image(systemName: "mappin.circle.fill").foregroundStyle(accent)
            }
            .keylineTint(accent)
        }
    }

    static func count(_ count: Int) -> String { count == 1 ? "1 task" : "\(count) tasks" }
}

private struct LockScreenView: View {
    let placeName: String
    let titles: [String]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Label("At \(placeName)", systemImage: "mappin.circle.fill")
                    .font(.headline)
                    .foregroundStyle(accent)
                    .lineLimit(1)
                Spacer()
                Text(PlaceActivityWidget.count(titles.count))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            TitleList(titles: titles, limit: 4)
        }
        .padding(16)
    }
}

private struct TitleList: View {
    let titles: [String]
    let limit: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(titles.prefix(limit).enumerated()), id: \.offset) { _, title in
                HStack(spacing: 8) {
                    Image(systemName: "circle")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text(title).lineLimit(1)
                }
            }
            if titles.count > limit {
                Text("+\(titles.count - limit) more")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
