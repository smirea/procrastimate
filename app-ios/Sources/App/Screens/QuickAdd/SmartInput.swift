import Core
import SwiftUI
import UIKit

/// The shared smart input of quick add, the details title, and the add-subtask field: a `TextEditor` on an
/// `AttributedString` that tints each parsed phrase, with `#` and `@` suggestions above it. Return submits instead of
/// adding a line. Token offsets are UTF-16, so they are mapped through `String.Index(utf16Offset:in:)`. While the editor
/// has focus, tints go straight to its text storage through `EditorTints` instead of through the binding.
struct SmartInput: View {
    @Environment(Store.self) private var store
    @Environment(\.space) private var space

    @Binding var text: String
    let tokens: [QuickAdd.Token]
    let label: String
    var placeholder = ""
    var suggestProjects = true
    var listAt: Binding<Int?> = .constant(nil)
    var focused: FocusState<Bool>.Binding
    let onSubmit: () -> Void

    /// About eight lines of body text.
    static let maxHeight: CGFloat = 200

    @State private var textHeight: CGFloat = 36
    @State private var attributed = AttributedString()
    @State private var selection = AttributedTextSelection()
    @State private var active = 0
    /// Arrow keys were used, so Return picks even when the typed name already matches.
    @State private var navigated = false
    @State private var dismissed: Int?
    /// The text this editor last wrote or showed. Typing can run ahead of rendering, so `onChange(of: text)` may
    /// still report an older keystroke, which must not overwrite the newer editor contents.
    @State private var written = ""
    #if DEBUG
    @State private var rendered = ""
    #endif

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
                .frame(height: min(max(textHeight, 36), Self.maxHeight))
                // The editor's own ideal height updates only while typing, so text set in code, such as a long title
                // when details open, would stay one line tall. A hidden copy of the text, with the editor's insets,
                // measures it instead. Past the cap the editor scrolls.
                .background(alignment: .topLeading) {
                    Text(text.isEmpty ? " " : text)
                        .padding(.vertical, 8)
                        .padding(.horizontal, 5)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .fixedSize(horizontal: false, vertical: true)
                        .hidden()
                        .onGeometryChange(for: CGFloat.self, of: { $0.size.height }) { height in
                            let grew = ceil(height) > textHeight
                            textHeight = ceil(height)
                            guard grew, focused.wrappedValue else { return }
                            Task {
                                // After the editor has taken its new height.
                                try? await Task.sleep(for: .milliseconds(60))
                                EditorCaret.reveal()
                            }
                        }
                        .accessibilityHidden(true)
                }
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
                #if DEBUG
                .background(alignment: .bottomTrailing) {
                    Color.clear
                        .frame(width: 1, height: 1)
                        .accessibilityElement()
                        .accessibilityLabel(rendered)
                        .accessibilityIdentifier("Rendered highlights")
                }
                #endif
        }
        .animation(.snappy(duration: 0.16), value: match)
        .onChange(of: match?.fragment, initial: true) {
            active = 0
            navigated = false
            listAt.wrappedValue = match?.fragment.start
        }
        .onAppear {
            attributed = AttributedString(text)
            written = text
        }
        .onChange(of: attributed) { typed() }
        .onChange(of: text) { replaceIfNeeded() }
        .onChange(of: Styled(text: text, tokens: tokens), initial: true) { restyle() }
        .task(id: Styled(text: text, tokens: tokens)) {
            // A keystroke can land between a change and its tinting, so tint again once typing pauses.
            try? await Task.sleep(for: .milliseconds(150))
            if !Task.isCancelled, focused.wrappedValue { tintEditor() }
        }
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
        let match = NameMatch.at(caret, in: text, store: store, space: space, kinds:suggestProjects ? [.project, .label] : [.label])
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
            write(plain.replacingOccurrences(of: "\n", with: ""))
            onSubmit()
            // Saving can clear the text in the same burst, which `onChange(of: text)` never sees.
            replace(with: text, caret: text.utf16.count)
            // Replacing the text mid-keystroke can resign the editor after the save already asked for focus.
            Task { focused.wrappedValue = true }
        } else if plain != text {
            write(plain)
        }
    }

    private func write(_ value: String) {
        written = value
        text = value
    }

    private func replaceIfNeeded() {
        guard text != written, text != String(attributed.characters) else { return }
        replace(with: text, caret: text.utf16.count)
    }

    private func replace(with value: String, caret: Int) {
        var next = AttributedString(value)
        style(&next, value)
        attributed = next
        written = value
        selection = AttributedTextSelection(insertionPoint: index(caret, in: next, value))
    }

    private func restyle() {
        let value = text
        guard String(attributed.characters) == value else { return }
        if focused.wrappedValue {
            // After SwiftUI hands the keystroke's update to the text view.
            Task { tintEditor() }
        } else {
            attributed.transform(updating: &selection) { style(&$0, value) }
        }
    }

    private func tintEditor() {
        let value = text
        let tints = tokens.filter { $0.end <= value.utf16.count }.map {
            EditorTints.Tint(range: NSRange(location: $0.start, length: $0.end - $0.start), color: UIColor($0.kind.tint))
        }
        EditorTints.apply(tints, to: value)
        #if DEBUG
        rendered = EditorTints.rendered()
        #endif
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
        write(inserted.text)
        replace(with: inserted.text, caret: inserted.caret)
        focused.wrappedValue = true
    }
}

private struct Styled: Equatable {
    let text: String
    let tokens: [QuickAdd.Token]
}
