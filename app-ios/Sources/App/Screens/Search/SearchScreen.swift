import Core
import SwiftUI

/// The search tab: `.searchable` over tasks, notes, projects, and labels, grouped and highlighted by `Core`'s
/// `Search`. A task opens task details, and a project or label pushes its screen onto the search tab. Return opens the
/// selected result, and a hardware keyboard's Up and Down move the selection, like the web's combobox.
struct SearchScreen: View {
    @Environment(Store.self) private var store
    @Environment(Navigator.self) private var navigator
    @Environment(IntentRouter.self) private var router

    @State private var query = ""
    @State private var active = 0
    @FocusState private var focused: Bool

    var body: some View {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let sections = SearchSections.sections(
            Search.search(query, store.tasks, projects: store.projects, labels: store.labels)
        )
        let rows = sections.flatMap(\.rows)
        List {
            ForEach(sections) { section in
                Section {
                    ForEach(section.rows) { row in
                        SearchResultRow(row: row, selected: rows.firstIndex(of: row) == active) { open(row) }
                    }
                } header: {
                    HStack {
                        Text(section.title)
                        Spacer()
                        Text("\(section.total)").monospacedDigit()
                    }
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.faint)
                    .accessibilityElement(children: .combine)
                    .accessibilityAddTraits(.isHeader)
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(.canvas)
        .scrollDismissesKeyboard(.immediately)
        .animation(.snappy(duration: 0.18), value: rows.map(\.id))
        .overlay {
            if trimmed.isEmpty {
                ContentUnavailableView(
                    "Search",
                    systemImage: "magnifyingglass",
                    description: Text("Find tasks, notes, projects, and labels.")
                )
            } else if rows.isEmpty {
                ContentUnavailableView("No results for “\(trimmed)”", systemImage: "magnifyingglass")
            }
        }
        .navigationTitle("Search")
        .searchable(text: $query, prompt: "Search tasks, notes, projects, and labels")
        .searchFocused($focused)
        .autocorrectionDisabled()
        .textInputAutocapitalization(.never)
        .onSubmit(of: .search) { open(rows.indices.contains(active) ? rows[active] : nil) }
        .onChange(of: query) { active = 0 }
        .onKeyPress(.downArrow) { move(1, in: rows) }
        .onKeyPress(.upArrow) { move(-1, in: rows) }
        .sensoryFeedback(.selection, trigger: active)
        // The search tab can be built before it is shown, so focus follows the selected tab instead of `onAppear`,
        // which would pull the keyboard away from quick add.
        .onAppear {
            applyRoutedQuery()
            if navigator.tab == .search { focused = true }
        }
        .onChange(of: navigator.tab) { focused = navigator.tab == .search }
        .onChange(of: router.searchQuery) { applyRoutedQuery() }
    }

    /// Search Tasks sets the query before this tab is shown, or while it is already on screen.
    private func applyRoutedQuery() {
        guard let routed = router.searchQuery else { return }
        router.searchQuery = nil
        if query != routed { query = routed }
        if navigator.tab == .search { focused = true }
    }

    private func move(_ step: Int, in rows: [SearchSections.Row]) -> KeyPress.Result {
        guard !rows.isEmpty else { return .ignored }
        active = (active + step + rows.count) % rows.count
        return .handled
    }

    private func open(_ row: SearchSections.Row?) {
        guard let row else { return }
        switch row {
        case let .project(hit): push(.project(id: hit.item.id))
        case let .label(hit): push(.label(id: hit.item.id))
        case let .task(hit): navigator.sheet = .details(taskID: hit.task.id)
        }
    }

    /// Results open on the search tab's own stack, so Back returns to the results.
    private func push(_ route: Route) {
        navigator.sheet = nil
        navigator.tab = .search
        navigator.paths[.search, default: []].append(route)
    }
}
