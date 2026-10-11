import Core
import SwiftUI

/// Task details: a sheet with a `NavigationStack`, so opening a subtask pushes its details. A subtask's back chip
/// returns to its parent: it pops when the parent is underneath, and slides the parent in when the subtask was opened
/// directly, such as from Today or search.
struct TaskDetailsSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var root: String
    @State private var path: [String] = []

    init(taskID: String) {
        _root = State(initialValue: taskID)
    }

    var body: some View {
        let navigation = DetailsNavigation(
            open: { path.append($0) },
            back: { parentID in
                if path.isEmpty {
                    withAnimation(reduceMotion ? nil : .snappy) { root = parentID }
                } else {
                    path.removeLast()
                }
            },
            close: { dismiss() }
        )
        NavigationStack(path: $path) {
            TaskDetailsPage(taskID: root, navigation: navigation)
                .id(root)
                .transition(.asymmetric(insertion: .move(edge: .leading), removal: .move(edge: .trailing)))
                .navigationDestination(for: String.self) { TaskDetailsPage(taskID: $0, navigation: navigation) }
        }
        .overlay(alignment: .bottom) {
            ToastStack().padding(.bottom, 8)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("Task details")
    }
}

/// How a details page moves within the sheet.
struct DetailsNavigation {
    let open: (_ taskID: String) -> Void
    let back: (_ parentID: String) -> Void
    let close: () -> Void

    /// A subtask's details return to its parent once the subtask is done or gone.
    func leave(_ parentID: String?) {
        if let parentID { back(parentID) } else { close() }
    }
}
