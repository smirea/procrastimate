import Core
import SwiftUI
import UIKit

/// Settings' entry to the tab bar's pins.
struct TabsSettingsLink: View {
    @Environment(Navigator.self) private var navigator
    @Environment(Store.self) private var store

    var body: some View {
        NavigationLink {
            TabsSettings()
        } label: {
            LabeledContent {
                Text(navigator.barPins(store).compactMap { store.label(of: $0)?.title }.joined(separator: ", "))
                    .lineLimit(1)
            } label: {
                SwiftUI.Label("Tabs", systemImage: "dock.rectangle")
            }
        }
        .accessibilityIdentifier("settings-tabs")
    }
}

/// Which screens the floating tab bar pins before Browse, in order. Anything Browse lists can be pinned except
/// Completed, up to what fits across the screen in portrait.
private struct TabsSettings: View {
    @Environment(Navigator.self) private var navigator
    @Environment(Store.self) private var store
    @Environment(\.today) private var today

    var body: some View {
        let pinned = navigator.barPins(store)
        let limit = TabBarMetrics.maxPins(screen: Self.portraitWidth)
        List {
            Section {
                ForEach(pinned, id: \.key) { pin in
                    if let label = store.label(of: pin) {
                        SwiftUI.Label(label.title, systemImage: label.systemImage)
                            .accessibilityIdentifier("tabs-pinned-\(label.title)")
                    }
                }
                .onMove { from, to in
                    var next = pinned
                    next.move(fromOffsets: from, toOffset: to)
                    save(next, shown: pinned)
                }
                .onDelete { offsets in
                    var next = pinned
                    next.remove(atOffsets: offsets)
                    save(next, shown: pinned)
                }
                SwiftUI.Label("Browse", systemImage: "square.grid.2x2")
                    .foregroundStyle(.muted)
            } header: {
                Text("Tabs")
            } footer: {
                Text("Browse always comes last. Up to \(limit) more fit across this screen. A tab with no open tasks hides until it has some, except Inbox.")
            }

            ForEach(store.pinGroups(excluding: navigator.pins, today: today)) { group in
                Section(group.title) {
                    ForEach(group.pins, id: \.key) { pin in
                        if let label = store.label(of: pin) {
                            Button {
                                save(pinned + [pin], shown: pinned)
                            } label: {
                                HStack(spacing: 12) {
                                    Image(systemName: "plus.circle.fill")
                                        .foregroundStyle(pinned.count < limit ? Color.green : Color.secondary)
                                        .imageScale(.large)
                                    SwiftUI.Label(label.title, systemImage: label.systemImage)
                                        .foregroundStyle(.ink)
                                }
                            }
                            .disabled(pinned.count >= limit)
                            .accessibilityLabel("Pin \(label.title)")
                        }
                    }
                }
            }
        }
        .environment(\.editMode, .constant(.active))
        .animation(.snappy, value: pinned)
        .sensoryFeedback(.selection, trigger: pinned)
        .navigationTitle("Tabs")
        .navigationBarTitleDisplayMode(.inline)
    }

    /// Keeps the pins this list can't show, such as a shared project not synced yet, after the ones it edits.
    private func save(_ next: [Pin], shown: [Pin]) {
        navigator.setPins(next + navigator.pins.filter { !shown.contains($0) })
    }

    private static var portraitWidth: CGFloat {
        let bounds = UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.screen.bounds }.first ?? .zero
        return min(bounds.width, bounds.height)
    }
}
