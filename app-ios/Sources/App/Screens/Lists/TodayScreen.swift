import SwiftUI

struct TodayScreen: View {
    @Environment(\.clock) private var clock

    var body: some View {
        ListEmptyState(title: "All clear for today", hint: "Enjoy it, or tap + to add something.")
            .navigationTitle("Today")
            .navigationSubtitle(
                clock.now.formatted(Date.FormatStyle(timeZone: clock.timeZone).weekday(.wide).month(.wide).day())
            )
    }
}
