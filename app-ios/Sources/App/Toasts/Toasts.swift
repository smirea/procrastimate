import Observation
import SwiftUI

@MainActor @Observable
final class Toasts {
    struct Action {
        let label: String
        let run: @MainActor () -> Void
    }

    struct Toast: Identifiable {
        let id: Int
        let message: String
        let action: Action?
    }

    private(set) var items: [Toast] = []
    @ObservationIgnored private var next = 0

    func show(_ message: String, action: Action? = nil, for duration: Duration = .seconds(5)) {
        next += 1
        let id = next
        withAnimation(.snappy) { items.append(Toast(id: id, message: message, action: action)) }
        Task {
            try? await Task.sleep(for: duration)
            dismiss(id)
        }
    }

    func dismiss(_ id: Int) {
        withAnimation(.snappy) { items.removeAll { $0.id == id } }
    }
}

struct ToastStack: View {
    @Environment(Toasts.self) private var toasts

    var body: some View {
        VStack(spacing: 8) {
            ForEach(toasts.items) { toast in
                HStack(spacing: 8) {
                    Text(toast.message)
                        .font(.subheadline)
                        .foregroundStyle(.ink)
                        .lineLimit(1)
                        .truncationMode(.middle)
                    if let action = toast.action {
                        Button(action.label) {
                            action.run()
                            toasts.dismiss(toast.id)
                        }
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.accent)
                        .padding(.horizontal, 12)
                        .frame(minHeight: 36)
                        .background(.ink.opacity(0.06), in: .capsule)
                        .contentShape(.capsule)
                    }
                }
                .padding(.leading, 16)
                .padding(.trailing, toast.action == nil ? 16 : 6)
                .padding(.vertical, 6)
                .frame(minHeight: 48)
                .glassEffect(.regular, in: .capsule)
                .accessibilityElement(children: .contain)
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .padding(.horizontal, 16)
    }
}
