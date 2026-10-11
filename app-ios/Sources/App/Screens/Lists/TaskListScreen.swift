import Core
import SwiftUI

/// A task list on the solid base layer, with its empty state and the floating add button that opens quick add with
/// the list's defaults.
struct TaskListScreen<Content: View>: View {
    let title: String
    let isEmpty: Bool
    let emptyTitle: String
    let emptyHint: String
    let quickAdd: QuickAddDefaults
    @ViewBuilder let content: () -> Content

    var body: some View {
        List {
            content()
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(.canvas)
        .overlay {
            if isEmpty {
                ListEmptyState(title: emptyTitle, hint: emptyHint)
                    .transition(.opacity)
            }
        }
        .animation(.snappy, value: isEmpty)
        .navigationTitle(title)
        .overlay(alignment: .bottomTrailing) {
            AddButton(defaults: quickAdd)
                .padding(.trailing, 16)
                .padding(.bottom, 12)
        }
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
