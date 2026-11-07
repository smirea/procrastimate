import Core
import Foundation

/// Which of the user's own projects a live webhook watches, as the server last said, kept for the launch. Webhooks live
/// on the server only, so this asks it again once the answer is a minute old; a hook with no projects watches them all.
@MainActor
@Observable
final class WebhookWatch {
    static let shared = WebhookWatch()

    private var hooks: [API.Webhook] = []
    @ObservationIgnored private var readAt = Date.distantPast

    /// Asking starts the read, so the first answer is false until it lands.
    func watches(_ projectID: String) -> Bool {
        if Date.now.timeIntervalSince(readAt) > 60 { refresh() }
        return Webhooks.watches(hooks, projectID)
    }

    private func refresh() {
        readAt = .now
        Task {
            if let list = try? await APIClient.send(API.Endpoints.WebhooksList.self, NoInput()) {
                hooks = list.webhooks
            } else {
                readAt = .distantPast
            }
        }
    }
}
