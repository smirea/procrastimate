import Core
import Observation
import SwiftUI
import UIKit

typealias ThemeChoice = API.ThemeChoice

extension ThemeChoice {
    var label: String {
        switch self {
        case .system: "System"
        case .light: "Light"
        case .dark: "Dark"
        }
    }

    var systemImage: String {
        switch self {
        case .system: "iphone"
        case .light: "sun.max"
        case .dark: "moon"
        }
    }

    var interfaceStyle: UIUserInterfaceStyle {
        switch self {
        case .system: .unspecified
        case .light: .light
        case .dark: .dark
        }
    }
}

extension Accent {
    var base: String {
        switch self {
        case .preset(let choice): choice.base
        case .custom(let base): base
        }
    }

    var preset: AccentChoice? {
        if case .preset(let choice) = self { choice } else { nil }
    }
}

/// A theme color's derived accent, on-accent, and canvas glow, each resolving to its light or dark value live.
struct AccentColors {
    let tint: Color
    let onTint: Color
    let glow: Color

    init(base: String) {
        let derived = Accents.deriveAccent(base)
        let pair = { (pick: (Accents.Tokens) -> SRGB) in Color(light: pick(derived.light), dark: pick(derived.dark)) }
        tint = pair { SRGB(rgb: $0.accent) }
        onTint = pair { SRGB(rgb: $0.onAccent) }
        glow = pair { SRGB(rgb: $0.glow, $0.glowAlpha) }
    }

    @MainActor static let presets = Dictionary(uniqueKeysWithValues: AccentChoice.allCases.map { ($0, AccentColors(base: $0.base)) })
}

/// Device preferences under the web's `procrastimate-theme` and `procrastimate-accent` keys, kept out of the task store so
/// they never sync. `System` and the default accent store nothing. A custom accent stores its `#rrggbb` base.
@MainActor @Observable
final class ThemeSettings {
    static let key = "procrastimate-theme"
    static let accentKey = "procrastimate-accent"

    /// One instance, because `.accent` reads it from any view; reading it in a body re-renders that view on a change.
    static let shared = ThemeSettings()

    private(set) var choice: ThemeChoice
    private(set) var accent: Accent
    private(set) var colors: AccentColors

    private init() {
        choice = UserDefaults.standard.string(forKey: Self.key).flatMap(ThemeChoice.init(rawValue:)) ?? .system
        let accent = Accents.parseAccent(UserDefaults.standard.string(forKey: Self.accentKey))
        self.accent = accent
        colors = Self.colors(for: accent)
    }

    private static func colors(for accent: Accent) -> AccentColors {
        accent.preset.flatMap { AccentColors.presets[$0] } ?? AccentColors(base: accent.base)
    }

    func chooseAccent(_ next: Accent) {
        guard next != accent else { return }
        accent = next
        colors = Self.colors(for: next)
        if next == .preset(Accents.defaultAccent) {
            UserDefaults.standard.removeObject(forKey: Self.accentKey)
        } else {
            UserDefaults.standard.set(next.rawValue, forKey: Self.accentKey)
        }
        apply()
    }

    func choose(_ next: ThemeChoice) {
        choice = next
        if next == .system {
            UserDefaults.standard.removeObject(forKey: Self.key)
        } else {
            UserDefaults.standard.set(next.rawValue, forKey: Self.key)
        }
        apply()
    }

    /// Sets the style on the window rather than through `preferredColorScheme`, which keeps the last forced style when
    /// it goes back to `nil` and does not restyle a sheet that is already open. Presented sheets and UIKit chrome
    /// such as the document picker inherit the window's style, and its tint, which replaces the AccentColor asset's.
    func apply() {
        for scene in UIApplication.shared.connectedScenes {
            for window in (scene as? UIWindowScene)?.windows ?? [] {
                window.overrideUserInterfaceStyle = choice.interfaceStyle
                window.tintColor = UIColor(colors.tint)
            }
        }
    }
}

extension ShapeStyle where Self == Color {
    @MainActor static var accent: Color { ThemeSettings.shared.colors.tint }
    @MainActor static var onAccent: Color { ThemeSettings.shared.colors.onTint }
    @MainActor static var accentGlow: Color { ThemeSettings.shared.colors.glow }
}

extension View {
    /// Under Reduce Motion, custom animations become instant, like the web's `motion()`.
    func motionFollowsAccessibility() -> some View {
        modifier(ReducedMotion())
    }
}

private struct ReducedMotion: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content.transaction { transaction in
            if reduceMotion { transaction.animation = nil }
        }
    }
}
