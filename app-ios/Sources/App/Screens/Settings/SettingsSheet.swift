import Core
import SwiftUI
import UniformTypeIdentifiers

/// Settings: the theme, the sync section, and `Import from Todoist`, the same panel as the web's settings sheet.
struct SettingsSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(ThemeSettings.self) private var theme
    @Environment(TodoistImport.self) private var importer

    @State private var picking = false

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

                Section {
                    Button("Set up sync", systemImage: "arrow.triangle.2.circlepath") {}
                        .disabled(true)
                } header: {
                    Text("Sync")
                } footer: {
                    Text("Syncing with your other devices is coming to the iPhone app.")
                }

                Section("Data") {
                    Button("Import from Todoist", systemImage: "square.and.arrow.down") { picking = true }
                    ImportOutcome(status: importer.status)
                }
            }
            .animation(.snappy, value: importer.status)
            .fileImporter(isPresented: $picking, allowedContentTypes: [.zip]) { result in
                switch result {
                case let .success(url): importer.run(url)
                case .failure: importer.failed("Couldn’t open this file.")
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done", role: .confirm) { dismiss() }
                }
            }
        }
        .sensoryFeedback(.selection, trigger: theme.choice)
    }
}

/// The import summary with its counts and warnings, or the error for a file that is not a backup.
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
                if summary.labels > 0 {
                    Text("\(summary.labels) \(plural(summary.labels, "label")) added")
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
