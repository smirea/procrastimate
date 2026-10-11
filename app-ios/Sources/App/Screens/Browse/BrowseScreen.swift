import Core
import SwiftUI

/// Projects and labels with their open counts, then Notifications and Settings, like the web sidebar.
struct BrowseScreen: View {
    @Environment(Navigator.self) private var navigator
    @Environment(Store.self) private var store

    @State private var adding = false
    @State private var name = ""
    @State private var created = 0
    @FocusState private var nameFocused: Bool

    var body: some View {
        let labels = Browse.labelsByName(store.labels)
        List {
            Section {
                ForEach(store.projects) { project in
                    NavigationLink(value: Route.project(id: project.id)) {
                        BrowseRow(
                            name: project.name,
                            systemImage: "number",
                            tone: .muted,
                            count: Views.projectTasks(store.tasks, project.id).count
                        )
                    }
                    .accessibilityIdentifier("browse-project-\(project.name)")
                }
                if adding {
                    TextField("Project name", text: $name)
                        .focused($nameFocused)
                        .submitLabel(.done)
                        .onSubmit(createProject)
                        .onAppear { nameFocused = true }
                        .transition(.opacity)
                }
            } header: {
                SectionHeader(title: "Projects") {
                    Button("Add project", systemImage: "plus") {
                        name = ""
                        withAnimation(.snappy) { adding = true }
                    }
                }
            }

            if !labels.isEmpty {
                Section {
                    ForEach(labels) { label in
                        NavigationLink(value: Route.label(id: label.id)) {
                            BrowseRow(
                                name: label.name,
                                systemImage: "tag",
                                tone: .toneLabel,
                                count: Views.labelTasks(store.tasks, label.id).count
                            )
                        }
                        .accessibilityIdentifier("browse-label-\(label.name)")
                    }
                } header: {
                    SectionHeader(title: "Labels") { EmptyView() }
                }
            }

            Section {
                NavigationLink(value: Route.notifications) {
                    SwiftUI.Label("Notifications", systemImage: "bell")
                }
                Button {
                    navigator.sheet = .settings
                } label: {
                    SwiftUI.Label("Settings", systemImage: "gearshape")
                }
                .foregroundStyle(.ink)
            }
        }
        .scrollContentBackground(.hidden)
        .background(.canvas)
        .navigationTitle("Browse")
        .animation(.snappy, value: store.projects)
        .animation(.snappy, value: labels)
        .onChange(of: nameFocused) {
            if !nameFocused, adding { createProject() }
        }
        .sensoryFeedback(.success, trigger: created)
    }

    /// Like the web sidebar: an empty name cancels, and a new project opens at once.
    private func createProject() {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        name = ""
        withAnimation(.snappy) { adding = false }
        guard !trimmed.isEmpty else { return }
        let project = withAnimation(.snappy) { store.addProject(trimmed) }
        created += 1
        navigator.paths[.browse, default: []].append(.project(id: project.id))
    }
}

/// A project or label in Browse: its tinted icon, its name, and its open count when it has any.
private struct BrowseRow: View {
    let name: String
    let systemImage: String
    let tone: Color
    let count: Int

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: systemImage)
                .foregroundStyle(tone)
                .frame(width: 22)
            Text(name)
                .foregroundStyle(.ink)
                .lineLimit(1)
            Spacer(minLength: 8)
            if count > 0 {
                Text("\(count)")
                    .font(.subheadline)
                    .foregroundStyle(.faint)
                    .monospacedDigit()
                    .contentTransition(.numericText())
            }
        }
        .animation(.snappy, value: count)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(name)
        .accessibilityValue(count > 0 ? "\(count)" : "")
    }
}

private struct SectionHeader<Action: View>: View {
    let title: String
    @ViewBuilder let action: () -> Action

    var body: some View {
        HStack {
            Text(title)
                .accessibilityAddTraits(.isHeader)
            Spacer()
            action()
                .labelStyle(.iconOnly)
                .font(.body.weight(.semibold))
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(.rect)
        }
    }
}
