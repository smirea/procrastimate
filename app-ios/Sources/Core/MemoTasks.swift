import Foundation

public typealias MemoSource = API.MemoSource

/// Tasks Talkward sent, from `shared/memo-tasks.ts`. Only the task's `sourceKey` marks one.
public enum MemoTasks {
    private static let prefix = "voicememo:"

    public static func memoSourceKey(_ source: MemoSource) -> String {
        "\(prefix)\(source.memoId):\(source.taskKey)"
    }

    /// The memo a task came from, or nil for a task the memo app did not send.
    public static func parseMemoSource(_ sourceKey: String?) -> MemoSource? {
        guard let sourceKey, sourceKey.hasPrefix(prefix) else { return nil }
        let parts = sourceKey.dropFirst(prefix.count).split(separator: ":", omittingEmptySubsequences: false)
        guard parts.count == 2, isUUID(parts[0]), isUUID(parts[1]) else { return nil }
        return MemoSource(memoId: String(parts[0]), taskKey: String(parts[1]))
    }

    /// Opens the memo in Talkward.
    public static func memoURL(_ memoId: String) -> URL {
        var components = URLComponents()
        components.scheme = "talkward"
        components.host = "entry"
        components.queryItems = [URLQueryItem(name: "id", value: memoId)]
        return components.url!
    }

    private static func isUUID(_ text: Substring) -> Bool {
        text.wholeMatch(of: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/) != nil
    }
}

extension TaskItem {
    /// The memo this task came from, when Talkward sent it.
    public var memoSource: MemoSource? { MemoTasks.parseMemoSource(sourceKey) }
}
