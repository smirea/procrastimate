import Core
import SwiftUI
import UIKit

/// The theme colors as a grid of swatches, each drawn in its own derived accent for the current appearance, and a
/// custom color from the system picker under them.
struct AccentPicker: View {
    @Environment(ThemeSettings.self) private var theme

    var body: some View {
        VStack(spacing: 12) {
            LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 5), spacing: 12) {
                ForEach(AccentChoice.allCases) { choice in
                    let colors = AccentColors.presets[choice]!
                    Button {
                        withAnimation(.snappy) { theme.chooseAccent(.preset(choice)) }
                    } label: {
                        Swatch(colors: colors, selected: theme.accent == .preset(choice))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(choice.name)
                    .accessibilityIdentifier("Accent \(choice.name)")
                    .accessibilityAddTraits(theme.accent == .preset(choice) ? .isSelected : [])
                }
            }

            ColorPicker(selection: custom, supportsOpacity: false) {
                HStack(spacing: 12) {
                    if theme.accent.preset == nil {
                        Swatch(colors: theme.colors, selected: true, size: 28)
                    } else {
                        Circle()
                            .fill(AngularGradient(colors: [.red, .orange, .yellow, .green, .cyan, .blue, .purple, .pink, .red], center: .center))
                            .frame(width: 28, height: 28)
                            .padding(3)
                    }
                    Text("Custom")
                    if theme.accent.preset == nil {
                        Spacer()
                        Text(theme.accent.base.uppercased())
                            .font(.footnote.monospaced())
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .padding(.horizontal, 8)
            .accessibilityIdentifier("Accent Custom")
            .accessibilityAddTraits(theme.accent.preset == nil ? .isSelected : [])
        }
        .padding(.vertical, 4)
    }

    /// Opens on the current base color; a pick is stored as its sRGB `#rrggbb`, which the web reads the same way.
    private var custom: Binding<Color> {
        Binding(
            get: { Color(SRGB(rgb: Accents.hexRgb(theme.accent.base)).uiColor) },
            set: { theme.chooseAccent(.custom(Self.hex($0))) }
        )
    }

    private static func hex(_ color: Color) -> String {
        var (r, g, b, a): (CGFloat, CGFloat, CGFloat, CGFloat) = (0, 0, 0, 0)
        UIColor(color).getRed(&r, green: &g, blue: &b, alpha: &a)
        let byte = { (c: CGFloat) in Int((min(1, max(0, c)) * 255).rounded()) }
        return "#" + [r, g, b].map { String(format: "%02x", byte($0)) }.joined()
    }
}

private struct Swatch: View {
    let colors: AccentColors
    let selected: Bool
    var size: CGFloat = 44

    var body: some View {
        Circle()
            .fill(colors.tint)
            .frame(width: size, height: size)
            .overlay {
                if selected {
                    Image(systemName: "checkmark")
                        .font(size < 40 ? .caption.weight(.bold) : .subheadline.weight(.bold))
                        .foregroundStyle(colors.onTint)
                        .transition(.scale.combined(with: .opacity))
                }
            }
            .padding(3)
            .overlay { Circle().strokeBorder(colors.tint, lineWidth: selected ? 2 : 0) }
    }
}
