import Core
import Foundation

/// What the server last read for each attached issue or pull request, by URL, kept for the launch. Asking again once
/// the answer is a minute old means a PR merged since shows as merged the next time its task opens.
@MainActor
@Observable
final class GithubItems {
    static let shared = GithubItems()

    private var items: [URL: GithubItem] = [:]
    @ObservationIgnored private var readAt: [URL: Date] = [:]

    /// The live title and state, or nil until the first read lands. Asking starts the read.
    func item(_ ref: GithubRef) -> GithubItem? {
        let url = Github.githubUrl(ref)
        if Date.now.timeIntervalSince(readAt[url] ?? .distantPast) > 60 { refresh(url) }
        return items[url]
    }

    private func refresh(_ url: URL) {
        readAt[url] = .now
        Task {
            if let item = try? await APIClient.send(API.Endpoints.Github.self, NoInput(), query: ["url": url.absoluteString]) {
                items[url] = item
            } else {
                readAt[url] = nil
            }
        }
    }
}
