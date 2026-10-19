import Core
import Observation
import SwiftUI
import UIKit

typealias ThemeChoice = API.ThemeChoice
typealias AccentChoice = API.AccentChoice

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

/// Device preferences under the web's `procrastimate-theme` and `procrastimate-accent` keys, kept out of the task store so
/// they never sync. `System` and the default accent store nothing.
@MainActor @Observable
final class ThemeSettings {
    static let key = "procrastimate-theme"
    static let accentKey = "procrastimate-accent"
    static let defaultAccent: AccentChoice = .frost

    /// One instance, because `.accent` reads it from any view; reading it in a body re-renders that view on a change.
    static let shared = ThemeSettings()

    private(set) var choice: ThemeChoice
    private(set) var accent: AccentChoice

    private init() {
        choice = UserDefaults.standard.string(forKey: Self.key).flatMap(ThemeChoice.init(rawValue:)) ?? .system
        accent = UserDefaults.standard.string(forKey: Self.accentKey).flatMap(AccentChoice.init(rawValue:)) ?? Self.defaultAccent
    }

    func chooseAccent(_ next: AccentChoice) {
        accent = next
        if next == Self.defaultAccent {
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
                window.tintColor = UIColor(accent.tint)
            }
        }
    }
}

extension ShapeStyle where Self == Color {
    @MainActor static var accent: Color { ThemeSettings.shared.accent.tint }
    @MainActor static var onAccent: Color { ThemeSettings.shared.accent.onTint }
    @MainActor static var accentGlow: Color { ThemeSettings.shared.accent.glow }
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
