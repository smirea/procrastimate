import SwiftUI

/// The theme colors as a grid of swatches, each drawn in its own derived accent for the current appearance.
struct AccentPicker: View {
    @Environment(ThemeSettings.self) private var theme

    var body: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 5), spacing: 12) {
            ForEach(AccentChoice.allCases) { choice in
                let selected = theme.accent == choice
                Button {
                    withAnimation(.snappy) { theme.chooseAccent(choice) }
                } label: {
                    Circle()
                        .fill(choice.tint)
                        .frame(width: 44, height: 44)
                        .overlay {
                            if selected {
                                Image(systemName: "checkmark")
                                    .font(.subheadline.weight(.bold))
                                    .foregroundStyle(choice.onTint)
                                    .transition(.scale.combined(with: .opacity))
                            }
                        }
                        .padding(3)
                        .overlay { Circle().strokeBorder(choice.tint, lineWidth: selected ? 2 : 0) }
                }
                .buttonStyle(.plain)
                .accessibilityLabel(choice.name)
                .accessibilityIdentifier("Accent \(choice.name)")
                .accessibilityAddTraits(selected ? .isSelected : [])
            }
        }
        .padding(.vertical, 4)
    }
}
