import Observation
import SwiftUI
import UIKit

/// System, Light, or Dark, the same three choices as the web.
enum ThemeChoice: String, CaseIterable, Identifiable {
    case system
    case light
    case dark

    var id: Self { self }

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

    var colorScheme: ColorScheme? {
        switch self {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }
}

/// A device preference under the web's `procrastimate-theme` key, kept out of the task store so it never syncs.
/// `System` stores nothing.
@MainActor @Observable
final class ThemeSettings {
    static let key = "procrastimate-theme"

    private(set) var choice: ThemeChoice

    init() {
        choice = UserDefaults.standard.string(forKey: Self.key).flatMap(ThemeChoice.init(rawValue:)) ?? .system
    }

    func choose(_ next: ThemeChoice) {
        choice = next
        if next == .system {
            UserDefaults.standard.removeObject(forKey: Self.key)
        } else {
            UserDefaults.standard.set(next.rawValue, forKey: Self.key)
        }
        if next == .system { Task { clearForcedStyle() } }
    }

    /// A `nil` `preferredColorScheme` leaves the last forced style on the window and the presented sheets, so going
    /// back to `System` clears it.
    private func clearForcedStyle() {
        for scene in UIApplication.shared.connectedScenes {
            for window in (scene as? UIWindowScene)?.windows ?? [] {
                window.overrideUserInterfaceStyle = .unspecified
                var controller = window.rootViewController
                while let current = controller {
                    current.overrideUserInterfaceStyle = .unspecified
                    controller = current.presentedViewController
                }
            }
        }
    }
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
