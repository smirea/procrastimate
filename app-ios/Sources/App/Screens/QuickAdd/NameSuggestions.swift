import Core
import SwiftUI

enum NameKind: CaseIterable {
    case project
    case section
    case label

    var sigil: NameSearch.Sigil {
        switch self {
        case .project: .project
        case .section: .section
        case .label: .label
        }
    }

    var list: String {
        switch self {
        case .project: "Projects"
        case .section: "Sections"
        case .label: "Labels"
        }
    }

    var noun: String {
        switch self {
        case .project: "project"
        case .section: "section"
        case .label: "label"
        }
    }

    var systemImage: String {
        switch self {
        case .project: "number"
        case .section: "rectangle.split.1x2"
        case .label: "tag"
        }
    }
}

struct NameMatch: Equatable {
    enum Suggestion: Hashable {
        case existing(id: String, name: String)
        case create(name: String)
    }

    let kind: NameKind
    let fragment: NameSearch.Fragment
    let suggestions: [Suggestion]
    /// The project whose sections a `/` match lists and creates in.
    var projectId: String?

    @MainActor
    /// Suggests only `space`'s names, or every space's when it is nil, as in quick add. A guest cannot create projects
    /// or labels in someone else's space, so creating happens in the user's own. `/` suggests the sections of
    /// `projectId`, the project in effect, and creates one only when that project is the user's own.
    static func at(
        _ caret: Int,
        in text: String,
        store: Store,
        space: SpaceKey?,
        kinds: [NameKind],
        projectId: String? = nil
    ) -> NameMatch? {
        let data = space.map { store.data(in: $0) } ?? store.everySpace
        let sections = projectId.map { StoreRules.sectionsOf(data.sections, $0) } ?? []
        let projectSpace = projectId.flatMap(store.space(ofProject:)) ?? .own
        var closest: (kind: NameKind, fragment: NameSearch.Fragment)?
        for kind in kinds {
            let found = switch kind {
            case .project: NameSearch.sigilFragment(text, caret, kind.sigil, data.projects)
            case .section: (space ?? projectSpace) == .own && projectId != nil ? NameSearch.sigilFragment(text, caret, kind.sigil, sections) : nil
            case .label: NameSearch.sigilFragment(text, caret, kind.sigil, data.labels)
            }
            if let found, found.start > closest?.fragment.start ?? -1 { closest = (kind, found) }
        }
        guard let (kind, fragment) = closest else { return nil }
        let suggestions: [Suggestion] = switch kind {
        case .project:
            NameSearch.suggest(data.projects, NameSearch.lastUsed(data.tasks, NameSearch.projectIdsOf), fragment.query)
                .map(Suggestion.init)
        case .section:
            NameSearch.suggest(sections, NameSearch.lastUsed(data.tasks, NameSearch.sectionIdsOf), fragment.query)
                .map(Suggestion.init)
        case .label:
            NameSearch.suggest(data.labels, NameSearch.lastUsed(data.tasks, NameSearch.labelIdsOf), fragment.query)
                .map(Suggestion.init)
        }
        let canCreate = space.map { $0 == .own } ?? (kind != .section || projectSpace == .own)
        let allowed = canCreate ? suggestions : suggestions.filter { if case .create = $0 { false } else { true } }
        return NameMatch(kind: kind, fragment: fragment, suggestions: allowed, projectId: projectId)
    }

    @MainActor
    func name(of suggestion: Suggestion, store: Store) -> String {
        switch suggestion {
        case let .existing(_, name): return name
        case let .create(name):
            switch kind {
            case .project: return store.addProject(name).name
            case .section: return projectId.flatMap { store.addSection($0, name)?.name } ?? name
            case .label: return store.addLabel(name).name
            }
        }
    }
}

extension NameMatch.Suggestion {
    init<Item>(_ suggestion: NameSearch.Suggestion<Item>) {
        switch suggestion {
        case let .existing(item): self = .existing(id: item.id, name: item.name)
        case let .create(name): self = .create(name: name)
        }
    }
}

struct NameSuggestionList: View {
    @Environment(Store.self) private var store
    let match: NameMatch
    let active: Int
    let onPick: (NameMatch.Suggestion) -> Void

    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(match.suggestions.enumerated()), id: \.element) { index, suggestion in
                Button {
                    onPick(suggestion)
                } label: {
                    row(suggestion)
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        .padding(.horizontal, 12)
                        .background(.ink.opacity(index == active ? 0.06 : 0), in: .rect(cornerRadius: 12))
                        .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(label(suggestion))
                .accessibilityAddTraits(index == active ? .isSelected : [])
            }
        }
        .animation(.snappy(duration: 0.12), value: active)
        .padding(4)
        .background(.ink.opacity(0.04), in: .rect(cornerRadius: 16))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(match.kind.list)
        .accessibilityIdentifier(match.kind.list)
    }

    private func label(_ suggestion: NameMatch.Suggestion) -> String {
        switch suggestion {
        case let .existing(_, name): name
        case let .create(name): "Create \(match.kind.noun) “\(name)”"
        }
    }

    @ViewBuilder private func row(_ suggestion: NameMatch.Suggestion) -> some View {
        switch suggestion {
        case let .existing(id, name):
            HStack(spacing: 10) {
                Image(systemName: systemImage(id)).foregroundStyle(.muted)
                highlighted(name).foregroundStyle(.ink).lineLimit(1)
            }
        case let .create(name):
            HStack(spacing: 10) {
                Image(systemName: "plus").foregroundStyle(.accent)
                Text("Create \(match.kind.noun) “\(name)”").foregroundStyle(.ink).lineLimit(1)
            }
        }
    }

    private func systemImage(_ id: String) -> String {
        switch match.kind {
        case .label: store.label(id)?.systemImage() ?? match.kind.systemImage
        case .project: store.project(id)?.systemImage ?? match.kind.systemImage
        case .section: match.kind.systemImage
        }
    }

    private func highlighted(_ name: String) -> Text {
        let query = match.fragment.query.trimmingCharacters(in: .whitespaces)
        guard !query.isEmpty, let range = name.range(of: query, options: .caseInsensitive) else { return Text(name) }
        let (head, match, tail) = (String(name[..<range.lowerBound]), String(name[range]), String(name[range.upperBound...]))
        return Text("\(head)\(Text(match).bold())\(tail)")
    }
}
