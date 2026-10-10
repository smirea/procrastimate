import SwiftUI

struct UpcomingScreen: View {
    var body: some View {
        ListEmptyState(title: "Nothing scheduled", hint: "Tasks due after today show up here, grouped by day.")
            .navigationTitle("Upcoming")
    }
}
