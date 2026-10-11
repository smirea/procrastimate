import Core
import SwiftUI

/// Everything typed after a sigil and picked by name: projects after `#`, labels after `@`. Both kinds share one
/// autocomplete, like the web's `NAME_SOURCES`.
enum NameKind: CaseIterable {
    case project
    case label

    var sigil: NameSearch.Sigil {
        switch self {
        case .project: .project
        case .label: .label
        }
    }

    /// The list's accessible name.
    var list: String {
        switch self {
        case .project: "Projects"
        case .label: "Labels"
        }
    }

    var noun: String {
        switch self {
        case .project: "project"
        case .label: "label"
        }
    }

    var systemImage: String {
        switch self {
        case .project: "number"
        case .label: "tag"
        }
    }
}

/// The `#` or `@` fragment at the caret with its ranked suggestions.
struct NameMatch: Equatable {
    enum Suggestion: Hashable {
        case existing(id: String, name: String)
        case create(name: String)
    }

    let kind: NameKind
    let fragment: NameSearch.Fragment
    let suggestions: [Suggestion]

    /// The fragment closest before the caret, of either kind.
    @MainActor
    static func at(_ caret: Int, in text: String, store: Store, kinds: [NameKind]) -> NameMatch? {
        var closest: (kind: NameKind, fragment: NameSearch.Fragment)?
        for kind in kinds {
            let found = switch kind {
            case .project: NameSearch.sigilFragment(text, caret, kind.sigil, store.projects)
            case .label: NameSearch.sigilFragment(text, caret, kind.sigil, store.labels)
            }
            if let found, found.start > closest?.fragment.start ?? -1 { closest = (kind, found) }
        }
        guard let (kind, fragment) = closest else { return nil }
        let suggestions: [Suggestion] = switch kind {
        case .project:
            NameSearch.suggest(store.projects, NameSearch.lastUsed(store.tasks, NameSearch.projectIdsOf), fragment.query)
                .map(Suggestion.init)
        case .label:
            NameSearch.suggest(store.labels, NameSearch.lastUsed(store.tasks, NameSearch.labelIdsOf), fragment.query)
                .map(Suggestion.init)
        }
        return NameMatch(kind: kind, fragment: fragment, suggestions: suggestions)
    }

    /// The name to insert, creating the project or label when the row offers to.
    @MainActor
    func name(of suggestion: Suggestion, store: Store) -> String {
        switch suggestion {
        case let .existing(_, name): return name
        case let .create(name):
            switch kind {
            case .project: return store.addProject(name).name
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

/// The suggestion list above the input, with the typed part of each name in bold.
struct NameSuggestionList: View {
    let match: NameMatch
    /// The row hardware keys move through and Return or Tab picks.
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
        case let .existing(_, name):
            HStack(spacing: 10) {
                Image(systemName: match.kind.systemImage).foregroundStyle(.muted)
                highlighted(name).foregroundStyle(.ink).lineLimit(1)
            }
        case let .create(name):
            HStack(spacing: 10) {
                Image(systemName: "plus").foregroundStyle(.accent)
                Text("Create \(match.kind.noun) “\(name)”").foregroundStyle(.ink).lineLimit(1)
            }
        }
    }

    private func highlighted(_ name: String) -> Text {
        let query = match.fragment.query.trimmingCharacters(in: .whitespaces)
        guard !query.isEmpty, let range = name.range(of: query, options: .caseInsensitive) else { return Text(name) }
        let (head, match, tail) = (String(name[..<range.lowerBound]), String(name[range]), String(name[range.upperBound...]))
        return Text("\(head)\(Text(match).bold())\(tail)")
    }
}
