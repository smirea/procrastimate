import Core
import Feedback
import Foundation

/// Feedback's GitHub Issue entry, which only Stefan's account gets: the server says whether the signed-in account may
/// file issues (`GET /api/feedback/github`), and the entry posts with the session as it is when the post is made.
enum FeedbackIssues {
    private struct SignedOut: LocalizedError {
        var errorDescription: String? { "Sign in to ProcrastiMate to file GitHub issues." }
    }

    @MainActor
    static func refresh(signedIn: Bool) async {
        let enabled = signedIn ? (try? await APIClient.send(API.Endpoints.FeedbackGithub.self, NoInput()))?.enabled : false
        guard let enabled else { return }
        Feedback.webhooks = enabled ? [webhook] : []
    }

    @MainActor
    private static var webhook: FeedbackWebhook {
        FeedbackWebhook(
            name: "GitHub Issue",
            url: AppEnvironment.apiURL.appending(path: "api/feedback/issues"),
            image: Feedback.githubIcon,
            headers: {
                guard let token = SessionToken.read() else { throw SignedOut() }
                return ["Authorization": "Bearer \(token)"]
            }
        )
    }
}
