import Core
import SwiftUI

struct UpcomingScreen: View {
    @Environment(Store.self) private var store
    @Environment(\.clock) private var clock

    var body: some View {
        let today = clock.today
        let groups = Views.upcomingGroups(store.tasks, today)
        TaskListScreen(
            title: "Upcoming",
            isEmpty: groups.isEmpty,
            emptyTitle: "Nothing scheduled",
            emptyHint: "Tasks due after today show up here, grouped by day.",
            quickAdd: QuickAddDefaults()
        ) {
            ForEach(groups, id: \.date) { group in
                Section {
                    ForEach(group.tasks) { TaskRow(task: $0, showProject: true, timeOnly: true) }
                } header: {
                    ListHeading(text: Format.dayHeading(group.date, today))
                }
            }
        }
    }
}
