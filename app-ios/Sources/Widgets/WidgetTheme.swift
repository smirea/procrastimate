import Core
import SwiftUI
import WidgetKit

/// The app's canvas: the theme color's warm glow at the top left and the cool one at the top right.
struct WidgetCanvas: View {
    let accent: AccentColors

    var body: some View {
        Color.canvas
            .overlay { glow(accent.glow, at: UnitPoint(x: 0.05, y: -0.15), radius: 280) }
            .overlay { glow(.canvasGlowCool, at: UnitPoint(x: 1, y: 0), radius: 220) }
    }

    private func glow(_ color: Color, at center: UnitPoint, radius: CGFloat) -> some View {
        RadialGradient(colors: [color, color.opacity(0)], center: center, startRadius: 0, endRadius: radius)
    }
}

/// The row checkbox of the app, a ring in the priority's tone, filled with a check while a row just checked off shows
/// struck through. It is a `Button`: a widget `Toggle` would flip the moment it is tapped, but the system then never
/// redrew the widget after the intent ran, so the row would stay. The system dims the row while the intent runs.
struct WidgetCheckbox: View {
    let tone: Color
    var checked = false
    var size: CGFloat = 20

    var body: some View {
        ZStack {
            Circle().fill(checked ? tone : tone.opacity(0.08))
            Circle().strokeBorder(tone, lineWidth: 1.5)
            if checked {
                Image(systemName: "checkmark")
                    .font(.system(size: size * 0.5, weight: .bold))
                    .foregroundStyle(.white)
            }
        }
        .frame(width: size, height: size)
        .widgetAccentable()
    }
}

/// The accent-filled `+` that opens quick add.
struct AddButton: View {
    let link: AppLink
    let accent: AccentColors
    var size: CGFloat = 28

    var body: some View {
        Button(intent: OpenAppLinkIntent(link: link.url)) {
            Image(systemName: "plus")
                .font(.system(size: size * 0.5, weight: .bold))
                .foregroundStyle(accent.onTint)
                .frame(width: size, height: size)
                .background(accent.tint, in: .circle)
                .widgetAccentable()
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Add task")
    }
}

struct SignedOutView: View {
    let accent: AccentColors

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Image(systemName: "person.crop.circle.badge.questionmark")
                .font(.title2)
                .foregroundStyle(accent.tint)
                .widgetAccentable()
            Text("Sign in to ProcrastiMate").font(.subheadline.weight(.semibold)).foregroundStyle(.ink)
            Text("Your lists show up here once you're signed in.").font(.caption).foregroundStyle(.muted)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}

struct MissingListView: View {
    let accent: AccentColors

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Image(systemName: "questionmark.folder")
                .font(.title2)
                .foregroundStyle(accent.tint)
                .widgetAccentable()
            Text("This list is gone").font(.subheadline.weight(.semibold)).foregroundStyle(.ink)
            Text("Touch and hold to pick another.").font(.caption).foregroundStyle(.muted)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}
