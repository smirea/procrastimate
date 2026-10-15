import UIKit

/// Tints parsed phrases in the focused editor's text storage directly. Writing the tints back through the
/// `TextEditor`'s `AttributedString` binding while UIKit is still applying a keystroke makes SwiftUI push a stale copy
/// of the text: the newest tint goes missing and a keystroke typed during the push, such as Return, is dropped.
/// Background attributes on the storage change neither the characters nor the selection, so typing never races them.
@MainActor
enum EditorTints {
    struct Tint: Equatable {
        let range: NSRange
        let color: UIColor
    }

    @discardableResult
    static func apply(_ tints: [Tint], to text: String) -> Bool {
        guard let view = focusedTextView(), view.text == text else { return false }
        let storage = view.textStorage
        let full = NSRange(location: 0, length: storage.length)
        guard current(in: storage) != tints else { return true }
        storage.beginEditing()
        storage.removeAttribute(.backgroundColor, range: full)
        for tint in tints where NSMaxRange(tint.range) <= storage.length {
            storage.addAttribute(.backgroundColor, value: tint.color, range: tint.range)
        }
        storage.endEditing()
        var typing = view.typingAttributes
        typing[.backgroundColor] = nil
        view.typingAttributes = typing
        return true
    }

    static func rendered() -> String {
        guard let view = focusedTextView() else { return "" }
        let text = view.textStorage.string as NSString
        return current(in: view.textStorage).map { text.substring(with: $0.range) }.joined(separator: "; ")
    }

    private static func current(in storage: NSTextStorage) -> [Tint] {
        var tints: [Tint] = []
        storage.enumerateAttribute(.backgroundColor, in: NSRange(location: 0, length: storage.length)) { value, range, _ in
            if let color = value as? UIColor { tints.append(Tint(range: range, color: color)) }
        }
        return tints
    }

    static func focusedTextView() -> UITextView? {
        let windows = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows)
        for window in windows where window.isKeyWindow {
            if let view = firstResponder(in: window) { return view }
        }
        return nil
    }

    private static func firstResponder(in view: UIView) -> UITextView? {
        if let text = view as? UITextView, text.isFirstResponder { return text }
        for subview in view.subviews {
            if let found = firstResponder(in: subview) { return found }
        }
        return nil
    }
}

/// A focused editor that grows past the bottom of the visible area, such as `Add subtask` at the end of a long task's
/// details, pushes its caret under the keyboard, and UIKit scrolls the caret into view only when the keyboard appears.
@MainActor
enum EditorCaret {
    static func reveal() {
        guard let view = EditorTints.focusedTextView(), let range = view.selectedTextRange else { return }
        var ancestor = view.superview
        while let candidate = ancestor, !(candidate is UIScrollView) { ancestor = candidate.superview }
        guard let scroll = ancestor as? UIScrollView, let window = scroll.window else { return }
        // The scroll view runs on under the keyboard, so `scrollRectToVisible` counts a caret behind it as visible.
        let caret = view.convert(view.caretRect(for: range.end), to: window)
        let keyboard = window.keyboardLayoutGuide.layoutFrame
        let bottom = min(scroll.convert(scroll.bounds, to: window).maxY - scroll.adjustedContentInset.bottom, keyboard.minY)
        let overflow = caret.maxY + 12 - bottom
        guard overflow > 0 else { return }
        let limit = scroll.contentSize.height + scroll.adjustedContentInset.bottom - scroll.bounds.height
        let y = min(scroll.contentOffset.y + overflow, max(limit, scroll.contentOffset.y))
        scroll.setContentOffset(CGPoint(x: scroll.contentOffset.x, y: y), animated: true)
    }
}
