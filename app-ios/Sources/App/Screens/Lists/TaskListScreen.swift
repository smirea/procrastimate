import Core
import SwiftUI

/// A task list on the tinted canvas, with its empty state and the floating add button that opens quick add with the
/// list's defaults. The button stands in for the web's inline `Add task` row; see `docs/decisions/ios.md`.
struct TaskListScreen<Content: View>: View {
    @Environment(Navigator.self) private var navigator
    let title: String
    let isEmpty: Bool
    let emptyTitle: String
    let emptyHint: String
    let quickAdd: QuickAddDefaults
    @ViewBuilder let content: () -> Content

    var body: some View {
        List {
            content()
                .listRowBackground(Color.clear)
        }
        .listStyle(.plain)
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
        .overlay(alignment: .bottomTrailing) {
            // Hidden under quick add, whose glass would otherwise show it through.
            if navigator.quickAdd == nil {
                AddButton(defaults: quickAdd)
                    .padding(.trailing, 16)
                    .padding(.bottom, 12)
                    .transition(.scale(scale: 0.6).combined(with: .opacity))
            }
        }
        .animation(.snappy(duration: 0.2), value: navigator.quickAdd == nil)
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

    /// `radial-gradient(<width> <height> at <center>, <color>, transparent 60%)`.
    private func glow(_ color: Color, at center: UnitPoint, width: CGFloat, height: CGFloat) -> some View {
        RadialGradient(colors: [color, color.opacity(0)], center: center, startRadius: 0, endRadius: width * 0.6)
            .scaleEffect(x: 1, y: height / width, anchor: center)
    }
}

/// The floating `.glassProminent` plus button, like the web's floating `Quick add`.
struct AddButton: View {
    @Environment(Navigator.self) private var navigator
    let defaults: QuickAddDefaults

    var body: some View {
        Button {
            navigator.sheet = .quickAdd(defaults)
        } label: {
            Image(systemName: "plus")
                .font(.title2.weight(.semibold))
                .frame(width: 44, height: 44)
        }
        .buttonStyle(.glassProminent)
        .buttonBorderShape(.circle)
        .accessibilityLabel("Quick add")
    }
}

/// A section heading in a list, such as `Overdue` or an Upcoming day.
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
