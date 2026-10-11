import SwiftUI
import UIKit

/// Explains what notifies and asks for permission only from `Turn on notifications`, like the web's Notifications
/// sheet. The web's Home Screen, sync, and server states have no iOS counterpart.
struct NotificationsScreen: View {
    @Environment(LocalNotifications.self) private var notifications
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL

    @State private var test = TestState.idle
    @State private var busy = false

    private enum TestState {
        case idle, sending, sent, failed

        var label: String {
            switch self {
            case .idle: "Send a test notification"
            case .sending: "Sending…"
            case .sent: "Sent"
            case .failed: "Couldn’t send"
            }
        }
    }

    private struct Action: Identifiable {
        let label: String
        var primary = false
        var disabled = false
        let run: () -> Void

        var id: String { label }
    }

    private struct Content {
        let icon: String
        let heading: String
        let body: [String]
        var actions: [Action] = []
    }

    var body: some View {
        let content = content(notifications.status)
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                Image(systemName: content.icon)
                    .font(.system(size: 26))
                    .symbolRenderingMode(.hierarchical)
                    .foregroundStyle(.accent)
                    .frame(width: 52, height: 52)
                    .background(.accent.opacity(0.1), in: .rect(cornerRadius: 16))
                    .accessibilityHidden(true)
                Text(content.heading)
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(.ink)
                    .padding(.top, 8)
                    .accessibilityAddTraits(.isHeader)
                ForEach(content.body, id: \.self) { paragraph in
                    Text(paragraph)
                        .font(.body)
                        .foregroundStyle(.muted)
                        .readout(notifications.status == .on ? notifications.pending : nil)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 20)
            .padding(.top, 12)
            .id(content.heading)
            .transition(.opacity)
        }
        .animation(.snappy, value: content.heading)
        .background(.canvas)
        .safeAreaInset(edge: .bottom) {
            VStack(spacing: 8) {
                ForEach(content.actions) { action in
                    if action.primary {
                        Button(action: action.run) { buttonLabel(action.label) }
                            .buttonStyle(.glassProminent)
                            .disabled(action.disabled)
                    } else {
                        Button(action: action.run) { buttonLabel(action.label) }
                            .buttonStyle(.glass)
                            .disabled(action.disabled)
                    }
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 12)
        }
        .navigationTitle("Notifications")
        .navigationBarTitleDisplayMode(.inline)
        .task { await notifications.detect() }
    }

    private func buttonLabel(_ text: String) -> some View {
        Text(text).font(.body.weight(.semibold)).frame(maxWidth: .infinity, minHeight: 36)
    }

    private func content(_ status: NotificationStatus) -> Content {
        switch status {
        case .checking:
            return Content(icon: "bell.fill", heading: "Notifications", body: ["Checking this device…"])
        case .off:
            return Content(
                icon: "bell.badge.fill",
                heading: "Get notified when tasks are due",
                body: [
                    "Procrastimate notifies you at each due time and reminder, even when the app is closed.",
                    "Dates without a time stay quiet. You can turn notifications off any time.",
                ],
                actions: [
                    Action(label: "Not now") { dismiss() },
                    Action(label: busy ? "Turning on…" : "Turn on notifications", primary: true, disabled: busy) {
                        perform { await notifications.enable() }
                    },
                ]
            )
        case .denied:
            return Content(
                icon: "bell.slash.fill",
                heading: "Notifications are blocked",
                body: ["Open Settings › Notifications › Procrastimate and turn on Allow Notifications."],
                actions: [
                    Action(label: "Open Settings", primary: true) {
                        if let url = URL(string: UIApplication.openNotificationSettingsURLString) { openURL(url) }
                    },
                ]
            )
        case .on:
            let count = notifications.pending.count
            return Content(
                icon: "bell.badge.fill",
                heading: "Notifications are on",
                body: [count > 0 ? "\(count) scheduled on this device" : "Nothing scheduled yet"],
                actions: [
                    Action(label: "Turn off", disabled: busy) { perform { await notifications.disable() } },
                    Action(label: test.label, primary: true, disabled: test == .sending) { sendTest() },
                ]
            )
        }
    }

    private func perform(_ run: @escaping @MainActor () async -> Void) {
        busy = true
        Task {
            await run()
            busy = false
        }
    }

    private func sendTest() {
        test = .sending
        Task {
            test = await notifications.sendTest() ? .sent : .failed
            try? await Task.sleep(for: .seconds(3))
            test = .idle
        }
    }
}

/// Browse's Notifications row, with the short status the web sidebar shows next to it.
struct NotificationsRow: View {
    @Environment(LocalNotifications.self) private var notifications

    var body: some View {
        NavigationLink(value: Route.notifications) {
            LabeledContent {
                Text(notifications.status.label ?? "")
            } label: {
                Label("Notifications", systemImage: "bell")
            }
        }
    }
}

private extension View {
    /// XCUITest cannot read `UNUserNotificationCenter`, so DEBUG builds carry the pending requests in the
    /// identifier of the scheduled count, as `title@<ISO time>: body` joined by `; `.
    @ViewBuilder func readout(_ pending: [String]?) -> some View {
        #if DEBUG
        if let pending {
            accessibilityIdentifier("pending: " + pending.joined(separator: "; "))
        } else {
            self
        }
        #else
        self
        #endif
    }
}
