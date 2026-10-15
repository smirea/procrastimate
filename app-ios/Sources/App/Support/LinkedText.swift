import Core
import SwiftUI

extension Links {
    /// The text with each link tappable in the accent color and each highlight mark on `tokenMatch`. A tap on a link
    /// opens it through `openURL` and never reaches the row's own tap.
    static func attributed(_ text: String, _ ranges: [Range<Int>] = []) -> AttributedString {
        var out = AttributedString()
        for segment in linkify(text, ranges) {
            var piece = Search.Highlight(text: segment.text, ranges: segment.marks).attributed
            if let href = segment.href, let url = URL(string: href) {
                piece.link = url
                piece.foregroundColor = .accent
                piece.underlineStyle = .single
            }
            out += piece
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
                    Text(Links.attributed(text))
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
