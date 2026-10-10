import SwiftUI

struct TaskDetailsSheet: View {
    let taskID: String

    var body: some View {
        NavigationStack {
            ContentUnavailableView("Task details", systemImage: "checklist")
                .navigationTitle("Task details")
                .navigationBarTitleDisplayMode(.inline)
        }
    }
}
