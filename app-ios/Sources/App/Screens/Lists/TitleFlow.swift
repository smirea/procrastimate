import Core
import SwiftUI

/// A task title with its labels inline after it, as chips in each label's color, in at most two lines. When it
/// overflows, the title takes the ellipsis and the labels stay visible at the end of the second line. This is iOS's one
/// label chip, as `LabelChip.svelte` is the web's.
struct TitleFlow: View {
    struct Chip {
        var text: AttributedString
        var color: LabelColor
    }

    let title: AttributedString
    let labels: [Chip]
    var done = false
    /// Nil shows the whole title, as a subtask row in task details does.
    var lineLimit: Int? = 2

    var body: some View {
        var text = Text(title)
            .foregroundStyle(done ? Color.faint : Color.ink)
            .strikethrough(done, color: .faint)
        for label in labels {
            text = Text("\(text) \(Self.chip(label))")
        }
        return text
            .lineLimit(lineLimit)
            // Middle truncation cuts the last line inside the title, so the labels after it stay on screen.
            .truncationMode(labels.isEmpty ? .tail : .middle)
            .textRenderer(LabelChipRenderer())
    }

    /// Non-breaking spaces keep a chip on one line; the narrow ones at its ends are the capsule's padding.
    private static func chip(_ label: Chip) -> Text {
        var name = label.text
        while let space = name.range(of: " ") {
            name.replaceSubrange(space, with: AttributedString("\u{00A0}"))
        }
        let icon = Text(Image(systemName: "tag.fill")).font(.caption2).accessibilityLabel("label")
        return Text("\u{202F}\(icon)\u{00A0}\(Text(name))\u{202F}")
            .font(.caption)
            .foregroundStyle(label.color.tone)
            .customAttribute(LabelChipRun(color: label.color))
    }
}

private struct LabelChipRun: TextAttribute {
    let color: LabelColor
}

/// Draws a capsule behind each chip's runs, which a `Text` cannot style on its own.
private struct LabelChipRenderer: TextRenderer {
    func draw(layout: Text.Layout, in context: inout GraphicsContext) {
        for line in layout {
            var chip: (rect: CGRect, color: LabelColor)?
            for run in line {
                let label = run[LabelChipRun.self]
                if let current = chip, label?.color != current.color {
                    fill(current.rect, current.color, in: &context)
                    chip = nil
                }
                if let label {
                    let bounds = run.typographicBounds.rect
                    chip = (chip.map { $0.rect.union(bounds) } ?? bounds, label.color)
                }
            }
            if let chip { fill(chip.rect, chip.color, in: &context) }
            context.draw(line)
        }
    }

    private func fill(_ rect: CGRect, _ color: LabelColor, in context: inout GraphicsContext) {
        context.fill(Capsule().path(in: rect.insetBy(dx: 0, dy: -1)), with: .color(color.fill))
    }
}
