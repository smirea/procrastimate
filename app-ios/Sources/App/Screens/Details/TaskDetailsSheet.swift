import Core
import SwiftUI

/// Task details: a sheet with a `NavigationStack`, so opening a subtask pushes its details. A subtask opened directly,
/// such as from Inbox or search, starts with its ancestors already underneath, so the back chip and the edge swipe both
/// pop to its parent. A parent that changed while open slides in instead.
struct TaskDetailsSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(TaskImages.self) private var images
    @State private var root: String
    @State private var path: [String] = []

    /// From the top-level task down to the one to show.
    init(stack: [String]) {
        _root = State(initialValue: stack[0])
        _path = State(initialValue: Array(stack.dropFirst()))
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
            ToastStack().padding(.bottom, 76)
        }
        // Once for the whole stack: a cover on each pushed page would have every page try to present it.
        .fullScreenCover(item: Bindable(images).viewing) { ImageViewer(start: $0) }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("Task details")
    }
}

struct DetailsNavigation {
    let open: (_ taskID: String) -> Void
    let back: (_ parentID: String) -> Void
    let close: () -> Void

    /// A subtask's details return to its parent once the subtask is done or gone.
    func leave(_ parentID: String?) {
        if let parentID { back(parentID) } else { close() }
    }
}
