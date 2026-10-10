import SwiftUI

/// A list's empty state, with the web's title and phone hint.
struct ListEmptyState: View {
    let title: String
    let hint: String

    var body: some View {
        VStack(spacing: 4) {
            Text(title).font(.body.weight(.medium)).foregroundStyle(.ink)
            Text(hint).font(.subheadline).foregroundStyle(.muted)
        }
        .multilineTextAlignment(.center)
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
