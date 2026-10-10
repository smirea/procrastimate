import SwiftUI
import UIKit

/// An sRGB color literal for the generated tokens: `0xRRGGBB` plus an opacity.
struct SRGB {
    let hex: UInt32
    let opacity: Double

    init(_ hex: UInt32, _ opacity: Double = 1) {
        self.hex = hex
        self.opacity = opacity
    }

    var uiColor: UIColor {
        UIColor(
            red: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: opacity
        )
    }
}

extension Color {
    /// Resolves per trait collection, so the color follows the effective appearance live.
    init(light: SRGB, dark: SRGB) {
        let light = light.uiColor, dark = dark.uiColor
        self.init(uiColor: UIColor { $0.userInterfaceStyle == .dark ? dark : light })
    }
}
