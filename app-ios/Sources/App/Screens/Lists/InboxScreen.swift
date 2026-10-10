import SwiftUI

struct InboxScreen: View {
    var body: some View {
        ListEmptyState(title: "Inbox zero", hint: "Tap + to capture a task.")
            .navigationTitle("Inbox")
    }
}
