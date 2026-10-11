import SwiftUI

/// `/` and Cmd-K open the search tab from a hardware keyboard, and Cmd-K again returns to the previous tab, like the
/// web. `/` only listens while no sheet is up and search is closed, so typing a `/` in quick add or the search field
/// stays text.
struct SearchShortcuts: ViewModifier {
    @Environment(Navigator.self) private var navigator
    @State private var previous: AppTab = .inbox

    func body(content: Content) -> some View {
        content.background {
            ZStack {
                Button("Search", action: toggle)
                    .keyboardShortcut("k", modifiers: .command)
                if navigator.sheet == nil, navigator.tab != .search {
                    Button("Search", action: toggle)
                        .keyboardShortcut("/", modifiers: [])
                }
            }
            .opacity(0)
            .frame(width: 0, height: 0)
            .accessibilityHidden(true)
        }
    }

    private func toggle() {
        if navigator.tab == .search, navigator.sheet == nil {
            navigator.tab = previous
        } else {
            if navigator.tab != .search { previous = navigator.tab }
            navigator.sheet = nil
            navigator.tab = .search
        }
    }
}

extension View {
    func searchShortcuts() -> some View { modifier(SearchShortcuts()) }
}
