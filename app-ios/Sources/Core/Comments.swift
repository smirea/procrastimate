import Foundation

public typealias Comment = API.Comment
public typealias CommentRead = API.CommentRead
public typealias CommentBadge = API.CommentBadge

/// `shared/comments.ts`: comments on tasks and who has read them. A comment lives in its task's space; a read marker
/// lives in the reader's own space, keyed by the task id.
public enum Comments {
    /// One task's comments, oldest first.
    public static func commentsOn(_ comments: [Comment], _ taskId: String) -> [Comment] {
        comments.filter { $0.taskId == taskId }.stableSorted { a, b in
            if a.createdAt != b.createdAt { return a.createdAt < b.createdAt }
            if a.id != b.id { return a.id.utf16.lexicographicallyPrecedes(b.id.utf16) }
            return nil
        }
    }

    /// Each commented task's badge, by task id. A comment is unread when someone other than `me` wrote it after the
    /// reader's marker for its task. A comment still waiting for the server's author stamp is the reader's own.
    public static func commentBadges(_ comments: [Comment], _ reads: [CommentRead], _ me: String?) -> [String: CommentBadge] {
        let readAt = Dictionary(reads.map { ($0.id, $0.readAt) }, uniquingKeysWith: { _, last in last })
        var badges: [String: CommentBadge] = [:]
        for comment in comments {
            var badge = badges[comment.taskId] ?? CommentBadge(count: 0, unread: 0)
            badge.count += 1
            if let author = comment.authorId, author != me, comment.createdAt > readAt[comment.taskId] ?? 0 {
                badge.unread += 1
            }
            badges[comment.taskId] = badge
        }
        return badges
    }

    /// Adds a comment by `authorId`, or returns the data unchanged with no comment when the body is blank.
    public static func addComment(
        _ data: StoreData, _ taskId: String, _ body: String, _ authorId: String, _ creation: Creation
    ) -> (data: StoreData, comment: Comment?) {
        let text = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return (data, nil) }
        let comment = Comment(id: creation.id, taskId: taskId, body: text, authorId: authorId, createdAt: creation.now)
        var next = data
        next.comments.append(comment)
        return (next, comment)
    }

    /// Rewrites `me`'s own comment. A blank or unchanged body, or someone else's comment, leaves the data as it was.
    public static func editComment(_ data: StoreData, _ id: String, _ body: String, _ me: String, _ now: Int) -> StoreData {
        let text = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let index = data.comments.firstIndex(where: { $0.id == id }), data.comments[index].authorId == me,
              !text.isEmpty, text != data.comments[index].body else { return data }
        var next = data
        next.comments[index].body = text
        next.comments[index].editedAt = now
        return next
    }

    /// Deletes `me`'s own comment. Someone else's stays.
    public static func deleteComment(_ data: StoreData, _ id: String, _ me: String) -> StoreData {
        guard data.comments.contains(where: { $0.id == id && $0.authorId == me }) else { return data }
        var next = data
        next.comments.removeAll { $0.id == id }
        return next
    }

    /// Marks a task's comments read in `me`'s own data. The marker never moves back, and it covers the newest comment
    /// even when that comment's clock ran ahead of `now`. Nothing changes when nobody else wrote since the marker.
    public static func markRead(_ own: StoreData, _ taskId: String, _ comments: [Comment], _ me: String, _ now: Int) -> StoreData {
        let newest = comments
            .filter { $0.taskId == taskId && $0.authorId != nil && $0.authorId != me }
            .map(\.createdAt)
            .max() ?? 0
        let index = own.reads.firstIndex { $0.id == taskId }
        let readAt = index.map { own.reads[$0].readAt } ?? 0
        guard newest > readAt else { return own }
        let read = CommentRead(id: taskId, readAt: max(now, newest))
        var next = own
        if let index { next.reads[index] = read } else { next.reads.append(read) }
        return next
    }
}
