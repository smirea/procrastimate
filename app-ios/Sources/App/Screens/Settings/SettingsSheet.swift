import Core
import SwiftUI
import UniformTypeIdentifiers

struct SettingsSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(ThemeSettings.self) private var theme
    @Environment(TodoistImport.self) private var importer
    @Environment(Store.self) private var store
    @Environment(LocalNotifications.self) private var notifications
    @Environment(SyncClient.self) private var sync

    @State private var picking = false
    @State private var confirmingDelete = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Theme") {
                    Picker("Theme", selection: Binding(get: { theme.choice }, set: { theme.choose($0) })) {
                        ForEach(ThemeChoice.allCases) { choice in
                            Text(choice.label).tag(choice)
                        }
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                }

                Section("Theme color") {
                    AccentPicker()
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets())
                }

                Section("Dictation") {
                    Picker("Dictation", selection: Binding(get: { store.dictation }, set: { store.setDictation($0) })) {
                        ForEach(DictationChoice.allCases) { choice in
                            Text(choice.label).tag(choice)
                        }
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                    .accessibilityLabel("Dictation")
                    .accessibilityIdentifier("Dictation")
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                }

                QuickAddButtonsSection()

                Section { TabsSettingsLink() }

                Section {
                    if notifications.status == .denied {
                        Button("Notifications need permission") {
                            Task { await notifications.openSettings() }
                        }
                    } else {
                        Text(notifications.status == .on ? "Notifications: On" : "Notifications: Off")
                    }
                }

                AIAccountsSection()

                Section("Data") {
                    Button("Import from Todoist", systemImage: "square.and.arrow.down") { picking = true }
                    ImportOutcome(status: importer.status)
                    Button("Delete all data", role: .destructive) { confirmingDelete = true }
                }

                Section {
                    Button("Sign out") { sync.signOut() }
                } header: {
                    Text("Account")
                } footer: {
                    Text("Version \(AppEnvironment.version)")
                        .monospacedDigit()
                        .frame(maxWidth: .infinity)
                        .padding(.top, 16)
                }
            }
            .animation(.snappy, value: importer.status)
            .fileImporter(isPresented: $picking, allowedContentTypes: [.zip]) { result in
                switch result {
                case let .success(url): importer.run(url)
                case .failure: importer.failed("Couldn’t open this file.")
                }
            }
            .confirmationDialog(
                "Delete every task, project, and label on this device and the server?",
                isPresented: $confirmingDelete,
                titleVisibility: .visible
            ) {
                Button("Delete all data", role: .destructive) { store.deleteAll() }
                Button("Cancel", role: .cancel) {}
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done", role: .confirm) { dismiss() }
                }
            }
        }
        .overlay(alignment: .bottom) { ToastStack() }
        .sensoryFeedback(.selection, trigger: theme.choice)
        .sensoryFeedback(.selection, trigger: store.dictation)
        .sensoryFeedback(.selection, trigger: theme.accent.preset)
    }
}

private struct QuickAddButtonsSection: View {
    @Environment(Store.self) private var store

    var body: some View {
        Section {
            ForEach(pinned) { toggle($0) }
                .onMove { from, to in
                    guard let from = from.first else { return }
                    let button = pinned[from]
                    let rest = pinned.filter { $0 != button }
                    let at = to > from ? to - 1 : to
                    store.setQuickAddButtons(
                        QuickAddButtons.moveButton(store.quickAddButtons, button, at < rest.count ? rest[at] : nil)
                    )
                }
            ForEach(QuickAddButton.allCases.filter { !pinned.contains($0) }) { toggle($0) }
        } header: {
            Text("Quick add buttons")
        } footer: {
            Text("Hold and drag a shown button to order the row. The rest stay in quick add’s + menu.")
        }
        .animation(.snappy, value: store.quickAddButtons)
    }

    private var pinned: [QuickAddButton] {
        QuickAddButtons.rowButtons(store.quickAddButtons, [], QuickAddButton.allCases)
    }

    private func toggle(_ button: QuickAddButton) -> some View {
        Toggle(isOn: Binding(
            get: { store.quickAddButtons.contains(button) },
            set: { _ in store.setQuickAddButtons(QuickAddButtons.toggleButton(store.quickAddButtons, button)) }
        )) {
            SwiftUI.Label(button.name, systemImage: button.systemImage)
        }
    }
}

private struct ImportOutcome: View {
    let status: TodoistImport.Status

    var body: some View {
        switch status {
        case .idle:
            EmptyView()
        case let .done(summary):
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 6) {
                    Stat(count: summary.projects, word: plural(summary.projects, "project"))
                    Stat(count: summary.tasks, word: plural(summary.tasks, "task"))
                    Stat(count: summary.skipped, word: "skipped")
                }
                if summary.sections > 0 || summary.labels > 0 {
                    let added = [(summary.sections, "section"), (summary.labels, "label")]
                        .filter { $0.0 > 0 }
                        .map { "\($0.0) \(plural($0.0, $0.1))" }
                    Text("\(added.joined(separator: " and ")) added")
                        .font(.footnote)
                        .foregroundStyle(.muted)
                }
                if !summary.warnings.isEmpty {
                    SwiftUI.Label(
                        "\(summary.warnings.count) \(plural(summary.warnings.count, "warning"))",
                        systemImage: "exclamationmark.triangle"
                    )
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(.muted)
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(Array(summary.warnings.enumerated()), id: \.offset) { _, warning in
                            Text(warning)
                                .font(.footnote)
                                .foregroundStyle(.muted)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                                .background(.ink.opacity(0.04), in: .rect(cornerRadius: 8))
                        }
                    }
                    .accessibilityElement(children: .contain)
                    .accessibilityLabel("Import warnings")
                }
            }
            .padding(.vertical, 4)
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Import summary")
            .transition(.opacity.combined(with: .offset(y: 6)))
            .id(summary)
        case let .failed(message):
            Text(message)
                .font(.subheadline)
                .foregroundStyle(.toneOverdue)
                .transition(.opacity.combined(with: .offset(y: 6)))
        }
    }

    private func plural(_ count: Int, _ word: String) -> String { count == 1 ? word : word + "s" }
}

private struct Stat: View {
    let count: Int
    let word: String

    var body: some View {
        VStack(spacing: 0) {
            Text("\(count)").font(.headline).foregroundStyle(.ink)
            Text(word).font(.caption).foregroundStyle(.muted)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 6)
        .background(.ink.opacity(0.05), in: .rect(cornerRadius: 10))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(count) \(word)")
    }
}
