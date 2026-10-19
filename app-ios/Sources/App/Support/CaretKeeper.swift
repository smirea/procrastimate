import UIKit

/// Keeps the focused field's caret in view whenever the layout around it moves, not only when its own text changes: a
/// subtask inserted above `Add subtask`, the title growing a line, a paste into a field at its height cap, the keyboard
/// changing height. Patching each field on its own text events missed every other move, and UIKit counts a caret behind
/// the keyboard as visible, because the page's scroll view runs on under it. Once the user scrolls the caret away
/// themselves, layout changes leave the page alone until the next keystroke.
@MainActor
final class CaretKeeper {
    static let shared = CaretKeeper()

    private weak var field: UIView?
    private weak var scroll: UIScrollView?
    private var observations: [NSKeyValueObservation] = []
    private var tokens: [NSObjectProtocol] = []
    /// The keyboard's frame in screen coordinates, or `.null` while it is down.
    private var keyboard = CGRect.null
    private var following = true
    /// The offset this keeper last set. Any other scroll, a drag, a status bar tap, or a `scrollTo`, is someone else's.
    private var placed: CGFloat = 0
    /// Only an edit scrolls inside the field, so text the user scrolled up to read inside it stays put.
    private var edited = false
    private var scheduled = false

    func start() {
        guard tokens.isEmpty else { return }
        let center = NotificationCenter.default
        let observe = { (name: Notification.Name, handle: @escaping @MainActor (Notification) -> Void) in
            center.addObserver(forName: name, object: nil, queue: .main) { note in
                // UIKit posts these on the main thread, which `queue: .main` delivers on as well.
                nonisolated(unsafe) let note = note
                MainActor.assumeIsolated { handle(note) }
            }
        }
        tokens = [
            observe(UITextView.textDidBeginEditingNotification) { [weak self] in self?.begin($0.object as? UIView) },
            observe(UITextField.textDidBeginEditingNotification) { [weak self] in self?.begin($0.object as? UIView) },
            observe(UITextView.textDidEndEditingNotification) { [weak self] in self?.end($0.object as? UIView) },
            observe(UITextField.textDidEndEditingNotification) { [weak self] in self?.end($0.object as? UIView) },
            observe(UITextView.textDidChangeNotification) { [weak self] in self?.changed($0.object as? UIView) },
            observe(UITextField.textDidChangeNotification) { [weak self] in self?.changed($0.object as? UIView) },
            observe(UIResponder.keyboardDidChangeFrameNotification) { [weak self] note in
                let frame = (note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue)?.cgRectValue ?? .null
                self?.keyboard = frame
                self?.schedule()
            },
            observe(UIResponder.keyboardDidHideNotification) { [weak self] _ in self?.keyboard = .null },
        ]
    }

    private func begin(_ view: UIView?) {
        guard let view else { return }
        field = view
        following = true
        observations = []
        var ancestor = view.superview
        while let candidate = ancestor, !(candidate is UIScrollView) { ancestor = candidate.superview }
        scroll = ancestor as? UIScrollView
        guard let scroll else { return schedule() }
        placed = scroll.contentOffset.y
        observations = [
            // SwiftUI sets the size on every layout pass, and each reveal would restart the scroll animation.
            scroll.observe(\.contentSize, options: [.old, .new]) { [weak self] _, change in
                guard change.oldValue != change.newValue else { return }
                MainActor.assumeIsolated { self?.schedule() }
            },
            scroll.observe(\.contentOffset) { [weak self] scroll, _ in
                MainActor.assumeIsolated {
                    guard let self, abs(scroll.contentOffset.y - self.placed) > 0.5 else { return }
                    self.placed = scroll.contentOffset.y
                    self.following = self.overflow() == 0
                }
            },
        ]
        schedule()
    }

    private func end(_ view: UIView?) {
        guard view === field else { return }
        field = nil
        scroll = nil
        observations = []
    }

    private func changed(_ view: UIView?) {
        guard view === field else { return }
        following = true
        edited = true
        schedule()
    }

    /// Once per run loop turn, after layout has placed the field and its caret where this change puts them.
    private func schedule() {
        guard !scheduled, field != nil else { return }
        scheduled = true
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            scheduled = false
            reveal()
        }
    }

    private func reveal() {
        if edited, let text = field as? UITextView { text.scrollRangeToVisible(text.selectedRange) }
        edited = false
        guard following, let scroll else { return }
        let delta = overflow()
        guard delta != 0 else { return }
        let inset = scroll.adjustedContentInset
        let top = -inset.top
        let limit = max(top, scroll.contentSize.height + inset.bottom - scroll.bounds.height)
        let y = min(max(scroll.contentOffset.y + delta, top), limit)
        guard abs(y - scroll.contentOffset.y) > 0.5 else { return }
        placed = y
        scroll.setContentOffset(CGPoint(x: scroll.contentOffset.x, y: y), animated: false)
    }

    /// How far the caret's line sits outside the visible part of the scroll view: positive below its bottom or the
    /// keyboard's top, negative above its top, zero in view.
    private func overflow() -> CGFloat {
        guard let field, let input = field as? UITextInput, let range = input.selectedTextRange,
              let scroll, let window = scroll.window else { return 0 }
        let caret = field.convert(input.caretRect(for: range.end), to: window)
        let frame = scroll.convert(scroll.bounds, to: window)
        let margin: CGFloat = 12
        var bottom = frame.maxY - scroll.adjustedContentInset.bottom
        if !keyboard.isNull {
            bottom = min(bottom, window.convert(keyboard, from: window.screen.coordinateSpace).minY)
        }
        let top = frame.minY + scroll.adjustedContentInset.top
        if caret.maxY + margin > bottom { return caret.maxY + margin - bottom }
        if caret.minY - margin < top { return caret.minY - margin - top }
        return 0
    }
}
