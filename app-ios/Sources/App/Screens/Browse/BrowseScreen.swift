import SwiftUI

struct BrowseScreen: View {
    @Environment(Navigator.self) private var navigator

    var body: some View {
        List {
            Section {
                NotificationsRow()
                Button {
                    navigator.sheet = .settings
                } label: {
                    Label("Settings", systemImage: "gearshape")
                }
                .foregroundStyle(.ink)
            }
        }
        .navigationTitle("Browse")
    }
}
