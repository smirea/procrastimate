import Core
import SwiftUI
import UIKit

/// The theme colors as two rows of swatches, each drawn in its own derived accent for the current appearance; the last
/// one opens the system picker for a custom color, and shows it once picked.
struct AccentPicker: View {
    @Environment(ThemeSettings.self) private var theme

    var body: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 5), spacing: 12) {
            ForEach(AccentChoice.allCases) { choice in
                let colors = AccentColors.presets[choice]!
                Button {
                    withAnimation(.snappy) { theme.chooseAccent(.preset(choice)) }
                } label: {
                    Swatch(fill: AnyShapeStyle(colors.tint), onFill: colors.onTint, ring: colors.tint, selected: theme.accent == .preset(choice))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(choice.name)
                .accessibilityIdentifier("Accent \(choice.name)")
                .accessibilityAddTraits(theme.accent == .preset(choice) ? .isSelected : [])
            }
            customSwatch
        }
        .padding(.vertical, 4)
    }

    /// The system well can't be restyled, so the swatch covers it and lets taps through. A transparent well stops
    /// opening the picker.
    private var customSwatch: some View {
        let selected = theme.accent.preset == nil
        return ColorPicker("Custom", selection: custom, supportsOpacity: false)
            .labelsHidden()
            .overlay {
                Swatch(
                    fill: selected ? AnyShapeStyle(theme.colors.tint) : AnyShapeStyle(Self.rainbow),
                    onFill: theme.colors.onTint,
                    ring: theme.colors.tint,
                    selected: selected
                )
                .allowsHitTesting(false)
                .accessibilityHidden(true)
            }
            .accessibilityValue(selected ? theme.accent.base.uppercased() : "")
            .accessibilityIdentifier("Accent Custom")
            .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private static let rainbow = AngularGradient(
        colors: [.red, .orange, .yellow, .green, .cyan, .blue, .purple, .pink, .red],
        center: .center
    )

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
    let fill: AnyShapeStyle
    let onFill: Color
    let ring: Color
    let selected: Bool

    var body: some View {
        Circle()
            .fill(fill)
            .frame(width: 44, height: 44)
            .overlay {
                if selected {
                    Image(systemName: "checkmark")
                        .font(.subheadline.weight(.bold))
                        .foregroundStyle(onFill)
                        .transition(.scale.combined(with: .opacity))
                }
            }
            .padding(3)
            .overlay { Circle().strokeBorder(ring, lineWidth: selected ? 2 : 0) }
    }
}
