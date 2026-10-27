import Core
import SwiftUI

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

    init(_ accent: Accent) {
        self.init(base: accent.base)
    }

    @MainActor static let presets = Dictionary(uniqueKeysWithValues: AccentChoice.allCases.map { ($0, AccentColors(base: $0.base)) })
}
