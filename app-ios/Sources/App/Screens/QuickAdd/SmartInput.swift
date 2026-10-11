import Core
import SwiftUI

/// The shared smart input of quick add, the details title, and the add-subtask field: a `TextEditor` on an
/// `AttributedString` that tints each parsed phrase, with `#` and `@` suggestions above it. Return submits instead of
/// adding a line. Token offsets are UTF-16, so they are mapped through `String.Index(utf16Offset:in:)`.
struct SmartInput: View {
    @Environment(Store.self) private var store

    @Binding var text: String
    let tokens: [QuickAdd.Token]
    let label: String
    var placeholder = ""
    var suggestProjects = true
    var focused: FocusState<Bool>.Binding
    let onSubmit: () -> Void

    @State private var attributed = AttributedString()
    @State private var selection = AttributedTextSelection()
    @State private var active = 0
    /// Arrow keys were used, so Return picks even when the typed name already matches.
    @State private var navigated = false
    /// The sigil position dismissed with Escape.
    @State private var dismissed: Int?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let match {
                NameSuggestionList(match: match, active: min(active, match.suggestions.count - 1)) { pick($0, in: match) }
                    .transition(.scale(scale: 0.96, anchor: .bottomLeading).combined(with: .opacity))
            }
            TextEditor(text: $attributed, selection: $selection)
                .focused(focused)
                .onKeyPress(keys: [.upArrow, .downArrow, .tab, .return, .escape]) { pressed($0.key) }
                .scrollContentBackground(.hidden)
                .scrollDisabled(true)
                .frame(minHeight: 36, maxHeight: 88)
                .fixedSize(horizontal: false, vertical: true)
                .overlay(alignment: .topLeading) {
                    if text.isEmpty {
                        Text(placeholder)
                            .foregroundStyle(.faint)
                            .padding(.top, 8)
                            .padding(.leading, 5)
                            .allowsHitTesting(false)
                            .accessibilityHidden(true)
                    }
                }
                .accessibilityLabel(label)
                .accessibilityIdentifier(highlightReadout)
        }
        .animation(.snappy(duration: 0.16), value: match)
        .onChange(of: match?.fragment) {
            active = 0
            navigated = false
        }
        .onAppear { attributed = AttributedString(text) }
        .onChange(of: attributed) { typed() }
        .onChange(of: text) { replaceIfNeeded() }
        .onChange(of: Styled(text: text, tokens: tokens), initial: true) { restyle() }
    }

    private var caret: Int {
        let index: AttributedString.Index = switch selection.indices(in: attributed) {
        case let .insertionPoint(index): index
        case let .ranges(ranges): ranges.ranges.last?.upperBound ?? attributed.endIndex
        }
        return String(attributed.characters[..<index]).utf16.count
    }

    private var match: NameMatch? { match(at: caret) }

    private func match(at caret: Int) -> NameMatch? {
        guard focused.wrappedValue else { return nil }
        let match = NameMatch.at(caret, in: text, store: store, kinds: suggestProjects ? [.project, .label] : [.label])
        guard let match, !match.suggestions.isEmpty, match.fragment.start != dismissed else { return nil }
        return match
    }

    /// The suggestion Return would pick: the active one, unless the typed name already matches and the arrows were
    /// never used, in which case Return saves.
    private func returnPick(in match: NameMatch) -> NameMatch.Suggestion? {
        let query = match.fragment.query.trimmingCharacters(in: .whitespaces).lowercased()
        let named = match.suggestions.contains {
            if case let .existing(_, name) = $0 { name.lowercased() == query } else { false }
        }
        return navigated || !named ? match.suggestions[min(active, match.suggestions.count - 1)] : nil
    }

    /// Hardware keys while suggestions are open, like the web's `handleKeydown`.
    private func pressed(_ key: KeyEquivalent) -> KeyPress.Result {
        guard let match else { return .ignored }
        let count = match.suggestions.count
        switch key {
        case .downArrow, .upArrow:
            active = (min(active, count - 1) + (key == .downArrow ? 1 : count - 1)) % count
            navigated = true
        case .tab:
            pick(match.suggestions[min(active, count - 1)], in: match)
        case .return:
            guard let suggestion = returnPick(in: match) else { return .ignored }
            pick(suggestion, in: match)
        case .escape:
            dismissed = match.fragment.start
        default:
            return .ignored
        }
        return .handled
    }

    /// Tokens as the editor's identifier, such as `due: tomorrow 5pm; priority: p1`, so UI tests can read what is
    /// highlighted without the text's attributes.
    private var highlightReadout: String {
        tokens.map { "\($0.kind.rawValue): \($0.text)" }.joined(separator: "; ")
    }

    private func typed() {
        let plain = String(attributed.characters)
        if plain.contains("\n") {
            if let match = match(at: max(0, caret - 1)), let suggestion = returnPick(in: match) {
                pick(suggestion, in: match)
                return
            }
            text = plain.replacingOccurrences(of: "\n", with: "")
            onSubmit()
            // Saving can clear the text in the same burst, which `onChange(of: text)` never sees.
            replace(with: text, caret: text.utf16.count)
        } else if plain != text {
            text = plain
        }
    }

    /// The text changed from outside, as after saving, `Keep as text`, or a pick.
    private func replaceIfNeeded() {
        guard text != String(attributed.characters) else { return }
        replace(with: text, caret: text.utf16.count)
    }

    private func replace(with value: String, caret: Int) {
        var next = AttributedString(value)
        style(&next, value)
        attributed = next
        selection = AttributedTextSelection(insertionPoint: index(caret, in: next, value))
    }

    private func restyle() {
        let value = text
        guard String(attributed.characters) == value else { return }
        attributed.transform(updating: &selection) { style(&$0, value) }
    }

    private func style(_ string: inout AttributedString, _ value: String) {
        string.backgroundColor = nil
        for token in tokens where token.end <= value.utf16.count {
            let range = index(token.start, in: string, value)..<index(token.end, in: string, value)
            string[range].backgroundColor = token.kind.tint
        }
    }

    private func index(_ offset: Int, in string: AttributedString, _ value: String) -> AttributedString.Index {
        let position = String.Index(utf16Offset: min(offset, value.utf16.count), in: value)
        return string.characters.index(string.startIndex, offsetBy: value[..<position].count)
    }

    private func pick(_ suggestion: NameMatch.Suggestion, in match: NameMatch) {
        let name = match.name(of: suggestion, store: store)
        let inserted = QuickAddDraft.insertingName(
            name, sigil: match.kind.sigil.rawValue, into: text, from: match.fragment.start, to: match.fragment.end
        )
        text = inserted.text
        replace(with: inserted.text, caret: inserted.caret)
        focused.wrappedValue = true
    }
}

private struct Styled: Equatable {
    let text: String
    let tokens: [QuickAdd.Token]
}
