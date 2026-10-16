import Core
import SwiftUI

/// Search at the top, then projects, places, events, and labels. Places and calendar events show while open tasks use
/// them. Typing a query swaps the list for search results.
struct BrowseScreen: View {
    @Environment(Navigator.self) private var navigator
    @FocusState private var searchFocused: Bool

    var body: some View {
        @Bindable var navigator = navigator
        let query = navigator.searchQuery
        Group {
            if query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                ScrollViewReader { BrowseList(scroll: $0) }
            } else {
                SearchResults(query: query)
            }
        }
        .background(.canvas)
        .navigationTitle("Browse")
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $navigator.searchQuery, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search")
        .searchFocused($searchFocused)
        .autocorrectionDisabled()
        .textInputAutocapitalization(.never)
        .onChange(of: navigator.focusSearch, initial: true) {
            guard navigator.focusSearch else { return }
            navigator.focusSearch = false
            searchFocused = true
        }
    }
}

private struct BrowseList: View {
    @Environment(Navigator.self) private var navigator
    @Environment(TaskActions.self) private var actions
    @Environment(Store.self) private var store
    @Environment(\.today) private var today

    @State private var adding = false
    @State private var name = ""
    @State private var created = 0
    @FocusState private var nameFocused: Bool
    let scroll: ScrollViewProxy

    var body: some View {
        let labels = Browse.labelsByName(store.labels)
        List {
            Section {
                NavigationLink(value: Route.completed) {
                    BrowseRow(name: "Completed", systemImage: "checkmark.circle", tone: .toneSoon, count: 0)
                }
                .accessibilityIdentifier("browse-completed")
            }

            Section {
                ForEach(store.projects) { project in
                    NavigationLink(value: Route.project(id: project.id)) {
                        BrowseRow(
                            name: project.name,
                            systemImage: "number",
                            tone: .muted,
                            count: Views.projectTasks(store.tasks, project.id, in: store.timeZone).count
                        )
                    }
                    .contextMenu {
                        Button("Copy as Markdown", systemImage: "doc.on.doc") { actions.copyAsMarkdown(project: project) }
                    }
                    .accessibilityIdentifier("browse-project-\(project.name)")
                }
                if adding {
                    TextField("Project name", text: $name)
                        .id(Self.newProject)
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

            let shared = Browse.sharedEntries(store.sharedSpaces)
            if !shared.isEmpty {
                Section {
                    ForEach(shared) { entry in
                        SharedRow(entry: entry)
                    }
                } header: {
                    SectionHeader(title: "Shared with me") { EmptyView() }
                }
            }

            let places = Triggers.placeGroups(store.tasks)
            if !places.isEmpty {
                Section {
                    ForEach(places, id: \.key) { place in
                        NavigationLink(value: Route.place(key: place.key)) {
                            BrowseRow(name: place.name, systemImage: "mappin.and.ellipse", tone: .accent, count: place.count)
                        }
                        .accessibilityIdentifier("browse-place-\(place.name)")
                    }
                } header: {
                    SectionHeader(title: "Places") { EmptyView() }
                }
            }

            let events = Triggers.eventGroups(store.tasks, today, in: store.timeZone)
            if !events.isEmpty {
                Section {
                    ForEach(events) { event in
                        NavigationLink(value: Route.event(id: event.id)) {
                            BrowseRow(name: event.title, systemImage: "calendar", tone: .toneWeek, count: event.count)
                        }
                        .accessibilityIdentifier("browse-event-\(event.title)")
                    }
                } header: {
                    SectionHeader(title: "Events") { EmptyView() }
                }
            }

            if !labels.isEmpty {
                Section {
                    ForEach(labels) { label in
                        NavigationLink(value: Route.label(id: label.id)) {
                            BrowseRow(
                                name: label.name,
                                systemImage: "tag",
                                tone: label.color.tone,
                                count: Views.labelTasks(store.tasks, label.id, in: store.timeZone).count
                            )
                        }
                        .accessibilityIdentifier("browse-label-\(label.name)")
                    }
                } header: {
                    SectionHeader(title: "Labels") { EmptyView() }
                }
            }

            Section {
                Button {
                    navigator.sheet = .settings
                } label: {
                    SwiftUI.Label("Settings", systemImage: "gearshape")
                }
                .foregroundStyle(.ink)
            }
        }
        .scrollContentBackground(.hidden)
        .animation(.snappy, value: store.projects)
        .animation(.snappy, value: labels)
        .onChange(of: nameFocused) {
            if !nameFocused, adding { createProject() }
        }
        .sensoryFeedback(.success, trigger: created)
        // A long project list puts the new field below the fold, where it never appears to take focus.
        .onChange(of: adding) {
            if adding { withAnimation(.snappy) { scroll.scrollTo(Self.newProject, anchor: .center) } }
        }
    }

    private static let newProject = "new-project"

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

/// A project, label, or task someone shared, with its owner's name where a project row has its count.
private struct SharedRow: View {
    @Environment(Navigator.self) private var navigator
    let entry: Browse.SharedEntry

    var body: some View {
        switch entry.kind {
        case .project:
            NavigationLink(value: Route.project(id: entry.id)) { label("number", .muted) }
        case .label:
            NavigationLink(value: Route.label(id: entry.id)) { label("tag", .toneLabel) }
        case .task:
            Button { navigator.sheet = .details(taskID: entry.id) } label: { label("checkmark.circle", .muted) }
        }
    }

    private func label(_ systemImage: String, _ tone: Color) -> some View {
        HStack(spacing: 12) {
            Image(systemName: systemImage)
                .foregroundStyle(tone)
                .frame(width: 22)
            Text(entry.name)
                .foregroundStyle(.ink)
                .lineLimit(1)
            Spacer(minLength: 8)
            PersonName(person: entry.owner)
                .font(.subheadline)
                .foregroundStyle(.faint)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(entry.name)
        .accessibilityValue("Shared by \(entry.owner.name)")
        .accessibilityIdentifier("browse-shared-\(entry.name)")
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
