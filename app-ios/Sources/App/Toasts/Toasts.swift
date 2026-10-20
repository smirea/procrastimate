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

    private struct Countdown {
        var remaining: Duration
        var startedAt = ContinuousClock.now
        var task: Task<Void, Never>?
        var holds = 0
    }

    private(set) var items: [Toast] = []
    @ObservationIgnored private var next = 0
    @ObservationIgnored private var countdowns: [Int: Countdown] = [:]

    func show(_ message: String, action: Action? = nil, for duration: Duration = .seconds(5)) {
        next += 1
        let id = next
        withAnimation(.snappy) { items.append(Toast(id: id, message: message, action: action)) }
        countdowns[id] = Countdown(remaining: duration)
        run(id)
    }

    /// Stops a toast's countdown while it is touched, hovered, or focused by VoiceOver. Each `hold` pairs with one `release`.
    func hold(_ id: Int) {
        guard var countdown = countdowns[id] else { return }
        if countdown.holds == 0 {
            countdown.task?.cancel()
            countdown.remaining -= ContinuousClock.now - countdown.startedAt
        }
        countdown.holds += 1
        countdowns[id] = countdown
    }

    func release(_ id: Int) {
        guard var countdown = countdowns[id] else { return }
        countdown.holds -= 1
        countdowns[id] = countdown
        if countdown.holds == 0 { run(id) }
    }

    func dismiss(_ id: Int) {
        countdowns.removeValue(forKey: id)?.task?.cancel()
        withAnimation(.snappy) { items.removeAll { $0.id == id } }
    }

    private func run(_ id: Int) {
        guard var countdown = countdowns[id] else { return }
        countdown.startedAt = .now
        countdown.task = Task { [remaining = countdown.remaining] in
            try? await Task.sleep(for: remaining)
            if !Task.isCancelled { dismiss(id) }
        }
        countdowns[id] = countdown
    }
}

struct ToastStack: View {
    @Environment(Toasts.self) private var toasts

    var body: some View {
        VStack(spacing: 8) {
            ForEach(toasts.items) { toast in
                ToastView(toast: toast)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .padding(.horizontal, 16)
    }
}

private struct ToastView: View {
    let toast: Toasts.Toast
    @Environment(Toasts.self) private var toasts
    @GestureState private var touched = false
    @State private var hovered = false
    @AccessibilityFocusState private var voiceOverFocused: Bool

    var body: some View {
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
                .accessibilityFocused($voiceOverFocused)
            }
        }
        .padding(.leading, 16)
        .padding(.trailing, toast.action == nil ? 16 : 6)
        .padding(.vertical, 6)
        .frame(minHeight: 48)
        .glassEffect(.regular, in: .capsule)
        .simultaneousGesture(DragGesture(minimumDistance: 0).updating($touched) { _, touched, _ in touched = true })
        .onHover { hovered = $0 }
        .accessibilityElement(children: .contain)
        .onChange(of: touched) { hold($1) }
        .onChange(of: hovered) { hold($1) }
        .onChange(of: voiceOverFocused) { hold($1) }
    }

    private func hold(_ held: Bool) {
        if held { toasts.hold(toast.id) } else { toasts.release(toast.id) }
    }
}
