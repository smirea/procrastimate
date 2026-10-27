import Foundation

public typealias AccentChoice = API.AccentChoice

/// The saved theme color: a preset, or a custom base color as `#rrggbb` in lowercase. Stored as `rawValue`, the same
/// string the web keeps under `procrastimate-accent`.
public enum Accent: Hashable, Sendable {
    case preset(AccentChoice)
    case custom(String)

    public var rawValue: String {
        switch self {
        case .preset(let choice): choice.rawValue
        case .custom(let base): base
        }
    }
}

/// Port of `shared/accents.ts`: derives a theme color's accent, on-accent, and canvas glow for each theme, moving the
/// OKLCH lightness until the accent meets the contrast target, so any custom color stays readable in both themes.
public enum Accents {
    public static let defaultAccent: AccentChoice = .frost

    public struct Tokens: Equatable, Sendable {
        public let accent: [Int]
        public let onAccent: [Int]
        public let glow: [Int]
        public let glowAlpha: Double
    }

    public struct Derived: Equatable, Sendable {
        public let light: Tokens
        public let dark: Tokens
    }

    public static func parseAccent(_ stored: String?) -> Accent {
        let custom = stored?.lowercased() ?? ""
        if custom.wholeMatch(of: /#[0-9a-f]{6}/) != nil { return .custom(custom) }
        return .preset(stored.flatMap(AccentChoice.init(rawValue:)) ?? defaultAccent)
    }

    /// `base` must be `#rrggbb`, which `parseAccent` and the color picker guarantee.
    public static func deriveAccent(_ base: String) -> Derived {
        let rgb = hexRgb(base)
        let lch = toOklch(rgb)
        let lightAccent = lightnessFor(lch, start: min(lch.l, 0.7), direction: -1, against: lightSurface, ratio: target)
        let glow = darkGlow(lch, rgb)
        let darkAccent = lightnessFor(lch, start: max(glow.lightness, 0.72), direction: 1, against: darkSurface, ratio: target)
        return Derived(
            light: Tokens(
                accent: lightAccent,
                onAccent: [255, 255, 255],
                glow: inGamut(Oklch(l: 0.93, c: min(lch.c, 0.05), h: lch.h)),
                glowAlpha: 0.6
            ),
            dark: Tokens(
                accent: darkAccent,
                onAccent: inGamut(Oklch(l: 0.2, c: min(lch.c, 0.05), h: lch.h)),
                glow: glow.rgb,
                glowAlpha: darkGlowAlpha
            )
        )
    }

    public static func hexRgb(_ hex: String) -> [Int] {
        guard hex.wholeMatch(of: /#[0-9a-fA-F]{6}/) != nil, let value = Int(hex.dropFirst(), radix: 16) else {
            preconditionFailure("Not a #rrggbb color: \(hex)")
        }
        return [(value >> 16) & 0xFF, (value >> 8) & 0xFF, value & 0xFF]
    }

    private struct Oklch {
        let l: Double
        let c: Double
        let h: Double
    }

    private static let lightSurface = [246, 246, 247]
    private static let darkSurface = [46, 46, 53]
    private static let target = 5.2
    private static let darkCanvas = [14, 14, 16]
    private static let darkGlowAlpha = 0.11
    private static let darkGlowingCanvasMax = 0.0135

    private static func toLinear(_ c: Double) -> Double {
        let s = c / 255
        return s <= 0.04045 ? s / 12.92 : pow((s + 0.055) / 1.055, 2.4)
    }

    private static func fromLinear(_ c: Double) -> Double {
        255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * pow(c, 1 / 2.4) - 0.055)
    }

    private static func luminance(_ rgb: [Double]) -> Double {
        0.2126 * toLinear(rgb[0]) + 0.7152 * toLinear(rgb[1]) + 0.0722 * toLinear(rgb[2])
    }

    private static func contrast(_ a: [Int], _ b: [Int]) -> Double {
        let (la, lb) = (luminance(a.map(Double.init)), luminance(b.map(Double.init)))
        return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)
    }

    private static func toOklch(_ rgb: [Int]) -> Oklch {
        let (lr, lg, lb) = (toLinear(Double(rgb[0])), toLinear(Double(rgb[1])), toLinear(Double(rgb[2])))
        let l = cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
        let m = cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
        let s = cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
        let L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
        let A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
        let B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
        return Oklch(l: L, c: hypot(A, B), h: atan2(B, A))
    }

    /// Linear sRGB, which falls outside 0...1 when the color is out of gamut.
    private static func oklchLinear(_ color: Oklch) -> [Double] {
        let (A, B) = (color.c * cos(color.h), color.c * sin(color.h))
        let l = pow(color.l + 0.3963377774 * A + 0.2158037573 * B, 3)
        let m = pow(color.l - 0.1055613458 * A - 0.0638541728 * B, 3)
        let s = pow(color.l - 0.0894841775 * A - 1.291485548 * B, 3)
        return [
            4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
            -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
            -0.0041960863 * l - 0.7034186147 * m + 1.707542331 * s,
        ]
    }

    /// The color at this lightness and hue, keeping as much chroma as sRGB can show.
    private static func inGamut(_ color: Oklch) -> [Int] {
        let fits = { (c: Double) in oklchLinear(Oklch(l: color.l, c: c, h: color.h)).allSatisfy { $0 >= 0 && $0 <= 1 } }
        var (lo, hi) = (0.0, color.c)
        if !fits(hi) {
            for _ in 0..<24 {
                let mid = (lo + hi) / 2
                if fits(mid) { lo = mid } else { hi = mid }
            }
        } else {
            lo = color.c
        }
        return oklchLinear(Oklch(l: color.l, c: lo, h: color.h)).map { Int(fromLinear(min(1, max(0, $0))).rounded()) }
    }

    private static func lightnessFor(_ base: Oklch, start: Double, direction: Double, against: [Int], ratio: Double) -> [Int] {
        var L = start
        while L >= 0 && L <= 1 {
            let rgb = inGamut(Oklch(l: L, c: base.c, h: base.h))
            if contrast(rgb, against) >= ratio { return rgb }
            L += direction * 0.005
        }
        return direction == 1 ? [255, 255, 255] : [0, 0, 0]
    }

    private static func darkGlow(_ lch: Oklch, _ rgb: [Int]) -> (lightness: Double, rgb: [Int]) {
        var L = lch.l
        while L > 0 {
            let glow = L == lch.l ? rgb : inGamut(Oklch(l: L, c: lch.c, h: lch.h))
            let tinted = (0..<3).map { Double(glow[$0]) * darkGlowAlpha + Double(darkCanvas[$0]) * (1 - darkGlowAlpha) }
            if luminance(tinted) <= darkGlowingCanvasMax { return (L, glow) }
            L -= 0.005
        }
        return (0, [0, 0, 0])
    }
}
