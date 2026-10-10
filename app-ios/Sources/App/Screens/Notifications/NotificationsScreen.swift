import SwiftUI

struct NotificationsScreen: View {
    var body: some View {
        ContentUnavailableView("Notifications", systemImage: "bell")
            .navigationTitle("Notifications")
    }
}
