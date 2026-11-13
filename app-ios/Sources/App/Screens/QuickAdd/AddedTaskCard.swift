import Core
import Feedback
import SwiftUI

/// The task quick add just saved, shown as its list row without the checkbox: above quick add, which keeps the list
/// behind it still, and then floating over the details it opens. A tap opens its details; `onClose` adds an `×`.
struct AddedTaskCard: View {
    @Environment(Store.self) private var store
    @Environment(Navigator.self) private var navigator
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    let taskID: String
    /// Where the card comes from: up out of quick add's title, or up from the bottom edge over details.
    var rise: CGFloat = 64
    var onClose: (() -> Void)?

    static let arrival = Animation.spring(duration: 0.55, bounce: 0.28)

    var body: some View {
        // Keyed by task, so a new save's card rises while the last one's leaves showing its own task.
        ZStack(alignment: .bottom) {
            // An untitled task expanded into details has nothing to show until it is named.
            if let task = store.task(taskID), !task.title.isEmpty {
                card(task)
                    .id(task.id)
                    .transition(reduceMotion ? .opacity : .asymmetric(
                        insertion: .modifier(active: Arrive(rise: rise), identity: Arrive(rise: 0)),
                        removal: .modifier(active: Leave(), identity: Leave(done: false))
                    ))
            }
        }
        .animation(Self.arrival, value: taskID)
        .feedback(self)
    }

    private func card(_ task: TaskItem) -> some View {
        TaskRow(task: task, showProject: true, placement: .card) {
            if let onClose {
                Button(action: onClose) {
                    Image(systemName: "xmark")
                        .font(.footnote.weight(.bold))
                        .foregroundStyle(.muted)
                        .frame(width: 44, height: 44)
                        .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Close preview")
            }
        }
        .padding(.leading, 16)
        .padding(.trailing, onClose == nil ? 16 : 4)
        .padding(.vertical, 4)
        .glassEffect(.regular, in: .rect(cornerRadius: 22, style: .continuous))
        // The whole card takes the tap, so none reaches the scrim behind quick add, which would close what it opens.
        .contentShape(.rect(cornerRadius: 22, style: .continuous))
        .onTapGesture { navigator.openAdded(task.id) }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("Added task")
    }
}

/// The title's text rising out of the field it was typed in: larger, lower, and soft, settling into the card.
private struct Arrive: ViewModifier {
    let rise: CGFloat

    func body(content: Content) -> some View {
        let progress = rise == 0 ? 1.0 : 0.0
        content
            .scaleEffect(1 + (1 - progress) * 0.14, anchor: .topLeading)
            .offset(y: rise)
            .blur(radius: (1 - progress) * 6)
            .opacity(rise == 0 ? 1 : 0.3)
    }
}

private struct Leave: ViewModifier {
    var done = true

    func body(content: Content) -> some View {
        content
            .scaleEffect(done ? 0.94 : 1)
            .offset(y: done ? -14 : 0)
            .opacity(done ? 0 : 1)
    }
}
