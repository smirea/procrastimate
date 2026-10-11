import SwiftUI

/// Cmd-K on a hardware keyboard opens the search tab at its field, and pressing it again returns to the previous tab,
/// like the web. The web's bare `/` is left out: a key command without a modifier would take the character from
/// whichever text field is focused, and SwiftUI has no app-wide text focus to gate it on.
struct SearchShortcuts: ViewModifier {
    @Environment(Navigator.self) private var navigator
    @State private var previous: AppTab = .inbox

    func body(content: Content) -> some View {
        content.background {
            Button("Search", action: toggle)
                .keyboardShortcut("k", modifiers: .command)
                .opacity(0)
                .frame(width: 0, height: 0)
                .accessibilityHidden(true)
        }
    }

    private func toggle() {
        if navigator.tab == .search, navigator.sheet == nil, navigator.paths[.search, default: []].isEmpty {
            navigator.tab = previous
        } else {
            if navigator.tab != .search { previous = navigator.tab }
            navigator.sheet = nil
            navigator.paths[.search] = []
            navigator.tab = .search
        }
    }
}

extension View {
    func searchShortcuts() -> some View { modifier(SearchShortcuts()) }
}
