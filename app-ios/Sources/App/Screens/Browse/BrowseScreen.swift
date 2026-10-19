import Core
import SwiftUI

struct BrowseScreen: View {
    @Environment(Navigator.self) private var navigator
    @Environment(SyncClient.self) private var sync
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
        .refreshable { await sync.refresh() }
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
    @Environment(Store.self) private var store
    @Environment(\.today) private var today

    @State private var adding = false
    @State private var name = ""
    @State private var created = 0
    @FocusState private var nameFocused: Bool
    let scroll: ScrollViewProxy

    var body: some View {
        let catalog = Dictionary(uniqueKeysWithValues: store.listCatalog(today: today).map { ($0.kind, $0) })
        let projects = catalog[.projects]!.entries
        let labels = catalog[.labels]!.entries
        List {
            let lists = catalog[.lists]!.entries.filter { !navigator.pins.contains(Pin($0)) }
            if !lists.isEmpty {
                Section {
                    ForEach(lists) { entry in
                        let pin = Pin(entry)
                        NavigationLink(value: pin.route) {
                            BrowseRow(name: entry.name, systemImage: pin.systemImage, tone: .accent, count: entry.count)
                        }
                        .accessibilityIdentifier("browse-\(pin.key)")
                    }
                }
            }

            Section {
                ForEach(projects) { project in
                    NavigationLink(value: Route.project(id: project.id)) {
                        BrowseRow(
                            name: project.name,
                            systemImage: store.project(project.id)?.systemImage ?? "number",
                            tone: .muted,
                            count: project.count
                        )
                    }
                    .accessibilityIdentifier("browse-project-\(project.name)")
                }
                .onMove { from, to in
                    guard let from = from.first else { return }
                    store.moveProject(projects[from].id, to: to > from ? to - 1 : to)
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

            // Shared tasks no shared list leads to are not lists, so they follow the shared lists.
            let sharedTasks = SpaceRouting.sharedEntries(store.sharedSpaces).filter { $0.kind == .task }
            let shared = catalog[.shared]!.entries.map { SharedRow(list: $0) } + sharedTasks.map { SharedRow(task: $0) }
            if !shared.isEmpty {
                Section {
                    ForEach(shared, id: \.id) { $0 }
                } header: {
                    SectionHeader(title: catalog[.shared]!.title) { EmptyView() }
                }
            }

            let places = catalog[.places]!
            if !places.entries.isEmpty {
                Section {
                    ForEach(places.entries) { place in
                        NavigationLink(value: Route.place(key: place.id)) {
                            BrowseRow(name: place.name, systemImage: "mappin.and.ellipse", tone: .accent, count: place.count)
                        }
                        .accessibilityIdentifier("browse-place-\(place.name)")
                    }
                } header: {
                    SectionHeader(title: places.title) { EmptyView() }
                }
            }

            let events = catalog[.events]!
            if !events.entries.isEmpty {
                Section {
                    ForEach(events.entries) { event in
                        NavigationLink(value: Route.event(id: event.id)) {
                            BrowseRow(name: event.name, systemImage: "calendar", tone: .toneWeek, count: event.count)
                        }
                        .accessibilityIdentifier("browse-event-\(event.name)")
                    }
                } header: {
                    SectionHeader(title: events.title) { EmptyView() }
                }
            }

            if !labels.isEmpty {
                Section {
                    ForEach(labels) { entry in
                        let label = store.label(entry.id)
                        NavigationLink(value: Route.label(id: entry.id)) {
                            BrowseRow(
                                name: entry.name,
                                systemImage: label?.systemImage() ?? "tag",
                                tone: label?.color.tone ?? .toneLabel,
                                count: entry.count
                            )
                        }
                        .accessibilityIdentifier("browse-label-\(entry.name)")
                    }
                } header: {
                    SectionHeader(title: catalog[.labels]!.title) { EmptyView() }
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

            Section {
                NavigationLink(value: Route.completed) {
                    BrowseRow(name: "Completed", systemImage: "checkmark.circle", tone: .toneSoon, count: 0)
                }
                .accessibilityIdentifier("browse-completed")
            }
        }
        .scrollContentBackground(.hidden)
        .animation(.snappy, value: projects.map(\.id))
        .animation(.snappy, value: labels.map(\.id))
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

private struct SharedRow: View {
    @Environment(Navigator.self) private var navigator
    @Environment(Store.self) private var store
    let kind: SpaceRouting.SharedEntry.Kind
    let id: String
    let name: String
    let owner: Person

    init(list: Lists.Entry) {
        kind = list.kind == .label ? .label : .project
        id = list.id
        name = list.name
        owner = list.owner!
    }

    init(task: SpaceRouting.SharedEntry) {
        kind = task.kind
        id = task.id
        name = task.name
        owner = task.owner
    }

    var body: some View {
        switch kind {
        case .project:
            NavigationLink(value: Route.project(id: id)) { label(store.project(id)?.systemImage ?? "number", .muted) }
        case .label:
            let shared = store.label(id)
            NavigationLink(value: Route.label(id: id)) { label(shared?.systemImage() ?? "tag", shared?.color.tone ?? .toneLabel) }
        case .task:
            Button { navigator.sheet = .details(taskID: id) } label: { label("checkmark.circle", .muted) }
        }
    }

    private func label(_ systemImage: String, _ tone: Color) -> some View {
        HStack(spacing: 12) {
            Image(systemName: systemImage)
                .foregroundStyle(tone)
                .frame(width: 22)
            Text(name)
                .foregroundStyle(.ink)
                .lineLimit(1)
            Spacer(minLength: 8)
            PersonName(person: owner)
                .font(.subheadline)
                .foregroundStyle(.faint)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(name)
        .accessibilityValue("Shared by \(owner.name)")
        .accessibilityIdentifier("browse-shared-\(name)")
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
