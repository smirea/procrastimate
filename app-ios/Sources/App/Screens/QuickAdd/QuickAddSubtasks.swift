import Core
import SwiftUI

/// A subtask typed into quick add, held until the parent saves.
struct DraftSubtask: Identifiable, Hashable {
    let id = UUID()
    let task: NewTask
}

/// Quick add's subtask lines under the title: each Return adds the line and keeps focus for the next, and Return on
/// an empty field saves the whole task. Lines parse like task details' `Add subtask`.
struct QuickAddSubtasks: View {
    @Environment(Store.self) private var store
    @Environment(\.clock) private var clock
    @Binding var subtasks: [DraftSubtask]
    @Binding var text: String
    var focused: FocusState<Bool>.Binding
    let save: () -> Void

    var body: some View {
        let parsed = QuickAdd.parseSubtask(text, now: clock.now, labels: store.labels, in: clock.timeZone)
        VStack(alignment: .leading, spacing: 2) {
            ForEach(subtasks) { subtask in
                row(subtask)
                    .transition(.asymmetric(insertion: .offset(y: -6).combined(with: .opacity), removal: .opacity))
            }
            HStack(spacing: 10) {
                Image(systemName: "plus")
                    .font(.footnote.weight(.bold))
                    .foregroundStyle(.accent)
                    .frame(width: 18)
                SmartInput(
                    text: $text,
                    tokens: parsed.tokens,
                    label: "Add subtask",
                    placeholder: "Add subtask",
                    suggestProjects: false,
                    focused: focused,
                    onSubmit: { add(parsed) }
                )
                .font(.subheadline)
                .padding(.leading, -5)
            }
            .frame(minHeight: 36)
        }
        .padding(.leading, 12)
        .overlay(alignment: .leading) {
            Rectangle().fill(Color.ink.opacity(0.1)).frame(width: 1)
        }
        .padding(.leading, 4)
        .animation(.snappy(duration: 0.2), value: subtasks)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("Subtasks")
    }

    private func add(_ parsed: QuickAdd.Parsed) {
        guard !text.trimmingCharacters(in: .whitespaces).isEmpty else { return save() }
        focused.wrappedValue = true
        guard let task = NewTask(subtask: parsed) else { return }
        subtasks.append(DraftSubtask(task: task))
        text = ""
    }

    private func row(_ subtask: DraftSubtask) -> some View {
        let task = subtask.task
        let today = clock.today
        return HStack(spacing: 10) {
            Image(systemName: "circle")
                .font(.subheadline)
                .foregroundStyle((task.priority ?? .p4) == .p4 ? Color.muted : (task.priority ?? .p4).tone)
                .frame(width: 18)
            VStack(alignment: .leading, spacing: 2) {
                Text(task.title)
                    .font(.subheadline)
                    .fixedSize(horizontal: false, vertical: true)
                let labels = store.labels.filter { task.labelIds.contains($0.id) }
                if task.due != nil || task.recurrence != nil || !labels.isEmpty {
                    HStack(spacing: 10) {
                        if let due = task.due {
                            SwiftUI.Label(Format.formatDue(due, today), systemImage: "calendar")
                                .foregroundStyle(Format.dueTone(due, today).color)
                        }
                        if let recurrence = task.recurrence {
                            SwiftUI.Label(Format.formatRecurrence(recurrence, task.due), systemImage: "repeat")
                                .foregroundStyle(.toneRepeat)
                        }
                        ForEach(labels) { label in
                            SwiftUI.Label(label.name, systemImage: "tag.fill").foregroundStyle(.muted)
                        }
                    }
                    .font(.caption)
                    .labelStyle(.compact)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Button {
                subtasks.removeAll { $0.id == subtask.id }
            } label: {
                Image(systemName: "xmark")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.muted)
                    .frame(width: 44, height: 44)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Remove \(task.title)")
        }
        .frame(minHeight: 36)
    }
}

private struct CompactLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 3) {
            configuration.icon.imageScale(.small)
            configuration.title
        }
    }
}

private extension LabelStyle where Self == CompactLabelStyle {
    static var compact: CompactLabelStyle { CompactLabelStyle() }
}
