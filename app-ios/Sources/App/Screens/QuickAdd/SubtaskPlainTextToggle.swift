import SwiftUI

/// A subtask line's own plain text toggle, apart from its task's, in quick add and in task details' `Add subtask`.
/// A row passes `enabled: false` where parsing would leave no title.
struct SubtaskPlainTextToggle: View {
    let on: Bool
    var enabled = true
    let toggle: () -> Void

    var body: some View {
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
}
