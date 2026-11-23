import Core
import Feedback
import SwiftUI

extension Store {
    /// The user's own reaction to a task, if any.
    @MainActor func myReaction(on taskID: String) -> ReactionEmoji? {
        reactions(on: taskID)?.first { $0.authorIds.contains(me) }?.emoji
    }

    @MainActor func reactorName(_ id: String) -> String {
        id == me ? "You" : person(id)?.name ?? "Someone"
    }
}

/// A task's reactions, the last thing in its row: each emoji as large as the row is tall, with no fill behind it, and a
/// count when more than one person picked it. Tapping one lists who reacted and, where the user may edit the task, picks
/// or takes back that emoji.
struct ReactionChips: View {
    @Environment(Store.self) private var store
    let task: TaskItem
    let groups: [ReactionGroup]

    var body: some View {
        HStack(spacing: 0) {
            ForEach(groups, id: \.emoji) { group in
                let mine = group.authorIds.contains(store.me)
                let names = group.authorIds.map(store.reactorName)
                Menu {
                    Section(names.joined(separator: ", ")) {
                        if !store.isReadOnly(task.id) {
                            Button(mine ? "Take back \(group.emoji.rawValue)" : "React \(group.emoji.rawValue)") {
                                withAnimation(.snappy) { store.react(task.id, group.emoji, by: store.me) }
                            }
                        }
                    }
                } label: {
                    HStack(spacing: 3) {
                        Text(group.emoji.rawValue).font(.title3)
                        if group.authorIds.count > 1 {
                            Text("\(group.authorIds.count)")
                                .font(.footnote.weight(.medium))
                                .foregroundStyle(.muted)
                                .monospacedDigit()
                        }
                    }
                    .padding(.horizontal, 6)
                    .frame(minWidth: 44, minHeight: 44)
                    .overlay { if mine { RoundedRectangle(cornerRadius: 12).strokeBorder(Color.accent.opacity(0.55), lineWidth: 1.5) } }
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(group.emoji.rawValue) \(names.joined(separator: ", "))")
                .accessibilityAddTraits(mine ? .isSelected : [])
                .accessibilityIdentifier("reaction-\(task.title)-\(group.emoji.rawValue)")
                .transition(.scale(scale: 0.6).combined(with: .opacity))
            }
        }
        .animation(.snappy(duration: 0.18), value: groups)
        .feedback(self)
    }
}

/// The five reactions, for a row's React swipe dialog or, as checkmarked toggles, its context menu. Picking the current
/// one takes it back.
struct ReactionButtons: View {
    @Environment(Store.self) private var store
    let task: TaskItem
    var toggles = false

    var body: some View {
        let mine = store.myReaction(on: task.id)
        ForEach(ReactionEmoji.allCases) { emoji in
            if toggles {
                Toggle(emoji.rawValue, isOn: Binding(get: { emoji == mine }, set: { _ in react(emoji) }))
            } else {
                Button(emoji == mine ? "Take back \(emoji.rawValue)" : emoji.rawValue) { react(emoji) }
            }
        }
    }

    private func react(_ emoji: ReactionEmoji) {
        withAnimation(.snappy) { store.react(task.id, emoji, by: store.me) }
    }
}
