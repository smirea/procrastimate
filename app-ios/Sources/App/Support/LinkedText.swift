import Core
import SwiftUI

extension Links {
    /// The text with each link tappable in the accent color, its site's icon before it, and each highlight mark on
    /// `tokenMatch`. A tap on a link opens it through `openURL` and never reaches the row's own tap. `icon` is the icon's
    /// side in points, about the font's cap height plus its descenders.
    @MainActor static func text(_ text: String, _ ranges: [Range<Int>] = [], icon: CGFloat = 15) -> Text {
        var out = Text(verbatim: "")
        for segment in linkify(text, ranges) {
            var piece = Search.Highlight(text: segment.text, ranges: segment.marks).attributed
            if let href = segment.href, let url = URL(string: href) {
                piece.link = url
                piece.foregroundColor = .accent
                piece.underlineStyle = .single
                if let image = Favicons.shared.icon(href, side: icon) {
                    let favicon = Text(Image(decorative: image, scale: UITraitCollection.current.displayScale))
                        .baselineOffset(-icon * 0.18)
                    out = Text("\(out)\(favicon)\u{2009}")
                }
            }
            out = Text("\(out)\(Text(piece))")
        }
        return out
    }

    static func hasLinks(_ text: String) -> Bool { linkify(text).contains { $0.href != nil } }
}

/// A text field that shows its text with live links until it takes focus. A tap outside a link focuses the field,
/// which then shows the raw text for editing.
struct LinkedField<Field: View>: View {
    let text: String
    let focused: FocusState<Bool>.Binding
    var inset = EdgeInsets()
    @ViewBuilder let field: Field

    var body: some View {
        let linked = !focused.wrappedValue && Links.hasLinks(text)
        field
            .opacity(linked ? 0 : 1)
            .overlay(alignment: .topLeading) {
                if linked {
                    Links.text(text)
                        .padding(inset)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                        .contentShape(.rect)
                        .onTapGesture { focused.wrappedValue = true }
                        .accessibilityAddTraits(.isButton)
                        .accessibilityHint("Edits the text")
                }
            }
    }
}
