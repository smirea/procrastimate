import Core
import SwiftUI

/// Search results under Browse's search field. Arrow keys on a hardware keyboard move the selection and Return opens it.
struct SearchResults: View {
    @Environment(Store.self) private var store
    @Environment(Navigator.self) private var navigator

    let query: String
    @State private var active = 0

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
        .scrollDismissesKeyboard(.immediately)
        .animation(.snappy(duration: 0.18), value: rows.map(\.id))
        .overlay {
            if rows.isEmpty {
                ContentUnavailableView("No results for “\(trimmed)”", systemImage: "magnifyingglass")
            }
        }
        .onSubmit(of: .search) { open(rows.indices.contains(active) ? rows[active] : nil) }
        .onChange(of: query) { active = 0 }
        .onKeyPress(.downArrow) { move(1, in: rows) }
        .onKeyPress(.upArrow) { move(-1, in: rows) }
        .sensoryFeedback(.selection, trigger: active)
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

    /// Results open on Browse's stack, so Back returns to the results.
    private func push(_ route: Route) {
        navigator.sheet = nil
        navigator.paths[.browse, default: []].append(route)
    }
}
