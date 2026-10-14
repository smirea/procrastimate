import SwiftUI

/// Cmd-K on a hardware keyboard opens Browse at its search field, like the web. The web's bare `/` is left out: a key
/// command without a modifier would take the character from whichever text field is focused, and SwiftUI has no
/// app-wide text focus to gate it on.
struct SearchShortcuts: ViewModifier {
    @Environment(Navigator.self) private var navigator

    func body(content: Content) -> some View {
        content.background {
            Button("Search") { navigator.showSearch() }
                .keyboardShortcut("k", modifiers: .command)
                .opacity(0)
                .frame(width: 0, height: 0)
                .accessibilityHidden(true)
        }
    }
}

extension View {
    func searchShortcuts() -> some View { modifier(SearchShortcuts()) }
}
