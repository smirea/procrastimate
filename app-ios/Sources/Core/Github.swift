import Foundation

public typealias GithubRef = API.GithubRef
public typealias GithubItem = API.GithubItem
public typealias GithubState = API.GithubState

/// GitHub issues and pull requests on a task, from `shared/github.ts`. The task keeps only which ones; their title and
/// state come live from the server's `GET /api/github`.
public enum Github {
    /// The issue or pull request a paste names: its URL, a page under it such as `/files`, or `owner/repo#12`.
    public static func parseGithubRef(_ text: String) -> GithubRef? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let url = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+\/[\w.-]+)\/(pull|issues)\/(\d+)(?:[\/?#]\S*)?$/
            .ignoresCase()
        if let match = trimmed.wholeMatch(of: url) {
            let kind: API.GithubKind = match.2.lowercased() == "pull" ? .pull : .issue
            return ref(String(match.1), match.3, kind)
        }
        if let match = trimmed.wholeMatch(of: /^([\w.-]+\/[\w.-]+)#(\d+)$/) {
            return ref(String(match.1), match.2, .issue)
        }
        return nil
    }

    private static func ref(_ repo: String, _ number: Substring, _ kind: API.GithubKind) -> GithubRef? {
        guard let number = Int(number), number > 0 else { return nil }
        return GithubRef(repo: repo, number: number, kind: kind)
    }

    public static func githubUrl(_ ref: GithubRef) -> URL {
        URL(string: "https://github.com/\(ref.repo)/\(ref.kind == .pull ? "pull" : "issues")/\(ref.number)")!
    }

    /// `procrastimate#309`: the repo's name without its owner, as a row has room for.
    public static func githubLabel(_ ref: GithubRef) -> String {
        "\(ref.repo.split(separator: "/").last ?? "")#\(ref.number)"
    }

    public static func same(_ a: GithubRef, _ b: GithubRef) -> Bool {
        a.repo.lowercased() == b.repo.lowercased() && a.number == b.number
    }

    /// Adds a ref unless the task already has it, and keeps the order they were attached in.
    public static func withGithubRef(_ refs: [GithubRef], _ ref: GithubRef) -> [GithubRef] {
        refs.contains { same($0, ref) } ? refs : refs + [ref]
    }
}
