import SwiftUI

/// A task title with its labels inline after it, as tinted chips, in at most two lines. When it overflows, the title
/// takes the ellipsis and the labels stay visible at the end of the second line.
struct TitleFlow: View {
    let title: AttributedString
    let labels: [AttributedString]
    var done = false

    var body: some View {
        var text = Text(title)
            .foregroundStyle(done ? Color.faint : Color.ink)
            .strikethrough(done, color: .faint)
        for label in labels {
            text = Text("\(text) \(Self.chip(label))")
        }
        return text
            .lineLimit(2)
            // Middle truncation cuts the last line inside the title, so the labels after it stay on screen.
            .truncationMode(labels.isEmpty ? .tail : .middle)
            .textRenderer(LabelChipRenderer())
    }

    /// Non-breaking spaces keep a chip on one line; the narrow ones at its ends are the capsule's padding.
    private static func chip(_ label: AttributedString) -> Text {
        var name = label
        while let space = name.range(of: " ") {
            name.replaceSubrange(space, with: AttributedString("\u{00A0}"))
        }
        let icon = Text(Image(systemName: "tag.fill")).font(.caption2).foregroundStyle(.toneLabel).accessibilityLabel("label")
        return Text("\u{202F}\(icon)\u{00A0}\(Text(name).foregroundStyle(.muted))\u{202F}")
            .font(.caption)
            .customAttribute(LabelChipRun())
    }
}

private struct LabelChipRun: TextAttribute {}

/// Draws a capsule behind each chip's runs, which a `Text` cannot style on its own.
private struct LabelChipRenderer: TextRenderer {
    func draw(layout: Text.Layout, in context: inout GraphicsContext) {
        for line in layout {
            var chip: CGRect?
            for run in line {
                if run[LabelChipRun.self] != nil {
                    let bounds = run.typographicBounds.rect
                    chip = chip.map { $0.union(bounds) } ?? bounds
                } else if let rect = chip {
                    fill(rect, in: &context)
                    chip = nil
                }
            }
            if let chip { fill(chip, in: &context) }
            context.draw(line)
        }
    }

    private func fill(_ rect: CGRect, in context: inout GraphicsContext) {
        context.fill(Capsule().path(in: rect.insetBy(dx: 0, dy: -1)), with: .color(.tokenLabel))
    }
}
