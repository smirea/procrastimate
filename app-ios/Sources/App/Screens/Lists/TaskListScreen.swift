import Core
import SwiftUI

/// A task list on the tinted canvas with its empty state. The title stays out of the way until the list scrolls, then
/// shows small in the bar. Quick add opens from the tab bar's add button with the list's defaults.
struct TaskListScreen<Content: View>: View {
    let title: String
    let isEmpty: Bool
    let emptyTitle: String
    let emptyHint: String
    /// A tab's root list has no back button, so it drops the bar and floats the title over the scroll edge instead.
    var root = false
    @ViewBuilder let content: () -> Content

    @State private var scrolled = false

    var body: some View {
        List {
            content()
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
                .listSectionSeparator(.hidden)
                .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))
        }
        .listStyle(.plain)
        .environment(\.defaultMinListRowHeight, 0)
        .scrollContentBackground(.hidden)
        .background { CanvasBackground() }
        .overlay {
            if isEmpty {
                ListEmptyState(title: emptyTitle, hint: emptyHint)
                    .transition(.opacity)
            }
        }
        .animation(.snappy, value: isEmpty)
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) { compactTitle }
        }
        .toolbarVisibility(root ? .hidden : .automatic, for: .navigationBar)
        .overlay(alignment: .top) {
            if root { compactTitle.offset(y: -6) }
        }
        .onScrollGeometryChange(for: Bool.self) { $0.contentOffset.y + $0.contentInsets.top > 4 } action: { _, value in
            scrolled = value
        }
    }

    private var compactTitle: some View {
        Text(title)
            .font(.subheadline.weight(.semibold))
            .opacity(scrolled ? 1 : 0)
            .animation(.snappy(duration: 0.2), value: scrolled)
            .accessibilityHidden(true)
    }
}

/// The web's page background: the canvas with a warm glow at the top left and a cool one at the top right, fixed to
/// the screen like the web's `background-attachment: fixed`.
struct CanvasBackground: View {
    var body: some View {
        Color.canvas
            .overlay { glow(.canvasGlowWarm, at: UnitPoint(x: 0.1, y: -0.1), width: 1200, height: 600) }
            .overlay { glow(.canvasGlowCool, at: UnitPoint(x: 1, y: 0), width: 900, height: 500) }
            .ignoresSafeArea()
    }

    private func glow(_ color: Color, at center: UnitPoint, width: CGFloat, height: CGFloat) -> some View {
        RadialGradient(colors: [color, color.opacity(0)], center: center, startRadius: 0, endRadius: width * 0.6)
            .scaleEffect(x: 1, y: height / width, anchor: center)
    }
}

struct ListHeading: View {
    let text: String
    var tone: Color = .ink

    var body: some View {
        Text(text)
            .font(.footnote.weight(.semibold))
            .foregroundStyle(tone)
            .textCase(nil)
            .accessibilityAddTraits(.isHeader)
    }
}
