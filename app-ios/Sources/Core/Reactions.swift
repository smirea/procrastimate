import Foundation

public typealias Reaction = API.Reaction
public typealias ReactionEmoji = API.ReactionEmoji
public typealias ReactionGroup = API.ReactionGroup

/// `shared/reactions.ts`: emoji reactions on tasks. A reaction lives in its task's space, and each person has at most
/// one per task, so its row id is `<task>:<author>`.
public enum Reactions {
    public static func reactionID(_ taskId: String, _ authorId: String) -> String { "\(taskId):\(authorId)" }

    /// Each reacted task's groups, by task id, in the picker's order.
    public static func reactionGroups(_ reactions: [Reaction]) -> [String: [ReactionGroup]] {
        Dictionary(grouping: reactions, by: \.taskId).mapValues { onTask in
            let byEmoji = Dictionary(grouping: onTask, by: \.emoji)
            return ReactionEmoji.allCases.compactMap { emoji in
                guard let list = byEmoji[emoji] else { return nil }
                return ReactionGroup(emoji: emoji, authorIds: list.stableSorted { $0.createdAt == $1.createdAt ? nil : $0.createdAt < $1.createdAt }.map(\.authorId))
            }
        }
    }

    /// Reacts to a task as `me`. Each person has one reaction per task: another emoji replaces theirs, and the same one
    /// takes it back.
    public static func react(_ data: StoreData, _ taskId: String, _ emoji: ReactionEmoji, _ me: String, _ now: Int) -> StoreData {
        let id = reactionID(taskId, me)
        var next = data
        if let index = data.reactions.firstIndex(where: { $0.id == id }) {
            if data.reactions[index].emoji == emoji {
                next.reactions.remove(at: index)
            } else {
                next.reactions[index].emoji = emoji
                next.reactions[index].createdAt = now
            }
        } else {
            next.reactions.append(Reaction(id: id, taskId: taskId, emoji: emoji, authorId: me, createdAt: now))
        }
        return next
    }
}
