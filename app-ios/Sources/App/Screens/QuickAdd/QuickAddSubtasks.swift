import Core
import SwiftUI

/// A subtask typed into quick add, held until the parent saves. It keeps its text, so its own plain text toggle can
/// re-read it after it is added.
struct DraftSubtask: Identifiable, Hashable {
    let id = UUID()
    let text: String
    var literal: Bool

    func task(now: Date, labels: [Core.Label], in zone: TimeZone, literal: Bool? = nil) -> NewTask? {
        NewTask(subtask: QuickAdd.parseSubtask(text, now: now, labels: labels, literal: literal ?? self.literal, in: zone))
    }
}

/// Quick add's subtask lines under the title: each Return adds the line and keeps focus for the next, and Return on
/// an empty field saves the whole task. Lines parse like task details' `Add subtask`, unless that line's own plain
/// text toggle is on; each new line starts with it off.
struct QuickAddSubtasks: View {
    @Environment(\.clock) private var clock
    let spaceLabels: [Core.Label]
    @Binding var subtasks: [DraftSubtask]
    @Binding var text: String
    @Binding var literal: Bool
    var focused: FocusState<Bool>.Binding
    let save: () -> Void

    @State private var rowsHeight: CGFloat = 0

    var body: some View {
        let parsed = QuickAdd.parseSubtask(text, now: clock.now, labels: spaceLabels, literal: literal, in: clock.timeZone)
        VStack(alignment: .leading, spacing: 2) {
            if !subtasks.isEmpty {
                // The card is docked to the keyboard, so a long list scrolls here, kept at its newest row, instead of
                // pushing the title off the top of the screen.
                ScrollView {
                    VStack(alignment: .leading, spacing: 2) {
                        ForEach(subtasks) { subtask in
                            row(subtask)
                                .transition(.asymmetric(insertion: .offset(y: -6).combined(with: .opacity), removal: .opacity))
                        }
                    }
                    .onGeometryChange(for: CGFloat.self, of: { ceil($0.size.height) }) { rowsHeight = $0 }
                }
                .frame(maxHeight: rowsHeight)
                .defaultScrollAnchor(.bottom)
                .defaultScrollAnchor(.bottom, for: .sizeChanges)
                .scrollBounceBehavior(.basedOnSize)
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
                    suggestNames: !literal,
                    maxHeight: 76,
                    focused: focused,
                    onSubmit: { add(parsed) }
                )
                .font(.subheadline)
                .padding(.leading, -5)
                plainTextToggle(literal) { literal.toggle() }
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
        guard NewTask(subtask: parsed) != nil else { return }
        subtasks.append(DraftSubtask(text: text, literal: literal))
        text = ""
        literal = false
    }

    /// A line's own toggle, apart from the task's. It can't turn off where parsing would leave no title.
    private func plainTextToggle(_ on: Bool, enabled: Bool = true, toggle: @escaping () -> Void) -> some View {
        Button(action: toggle) {
            Image(systemName: "textformat")
                .font(.caption.weight(on ? .bold : .regular))
                .foregroundStyle(on ? Color.accent : Color.muted)
                .frame(width: 36, height: 44)
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.4)
        .accessibilityLabel("Plain text subtask")
        .accessibilityValue(on ? "On" : "Off")
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    @ViewBuilder
    private func row(_ subtask: DraftSubtask) -> some View {
        if let task = subtask.task(now: clock.now, labels: spaceLabels, in: clock.timeZone) {
            row(subtask, task)
        }
    }

    private func row(_ subtask: DraftSubtask, _ task: NewTask) -> some View {
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
                let labels = spaceLabels.filter { task.labelIds.contains($0.id) }
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
                            SwiftUI.Label(label.name, systemImage: label.systemImage(filled: true)).foregroundStyle(label.color.tone)
                        }
                    }
                    .font(.caption)
                    .labelStyle(.compact)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            plainTextToggle(
                subtask.literal,
                enabled: !subtask.literal || subtask.task(now: clock.now, labels: spaceLabels, in: clock.timeZone, literal: false) != nil
            ) {
                guard let index = subtasks.firstIndex(where: { $0.id == subtask.id }) else { return }
                subtasks[index].literal.toggle()
            }
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
