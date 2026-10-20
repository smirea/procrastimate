import UIKit
import UniformTypeIdentifiers

/// Takes the images of a paste into a text view, through the text view's own paste, and hands them to the focused smart
/// input's owner. SwiftUI's `TextEditor` keeps only U+FFFC from an image paste, and reading the image back from
/// `UIPasteboard` afterwards shows the system "Allow Paste" prompt on every paste. A paste delegate receives the items the
/// user chose to paste, which needs no permission.
@MainActor
final class ImagePaste: NSObject, UITextPasteDelegate {
    static let shared = ImagePaste()

    private struct Claim {
        let owner: UUID
        /// Nil until the claimed field's text view begins editing, which a tap does before SwiftUI's focus changes and
        /// focus set in code does after.
        weak var window: UIWindow?
        let handler: (@escaping ImageLoad) -> Void
    }

    /// One per window, since each iPad window has its own focused field.
    private var claims: [Claim] = []
    private weak var editing: UITextView?
    private var pending: [NSItemProvider] = []
    private var token: NSObjectProtocol?

    func start() {
        guard token == nil else { return }
        token = NotificationCenter.default.addObserver(
            forName: UITextView.textDidBeginEditingNotification, object: nil, queue: .main
        ) { note in
            // UIKit posts this on the main thread, which `queue: .main` delivers on as well.
            nonisolated(unsafe) let note = note
            MainActor.assumeIsolated { ImagePaste.shared.install(on: note.object as? UITextView) }
        }
    }

    /// Images pasted while `owner` is focused go to `handler`, until `owner` lets go.
    func claim(_ owner: UUID, handler: @escaping (@escaping ImageLoad) -> Void) {
        claims.removeAll { $0.owner == owner }
        claims.append(Claim(owner: owner, window: nil, handler: handler))
        if let editing, editing.isFirstResponder { bind(editing.window) }
    }

    private func bind(_ window: UIWindow?) {
        guard let window, var pending = claims.last(where: { $0.window == nil }) else { return }
        claims.removeAll { $0.window == nil || $0.window === window }
        pending.window = window
        claims.append(pending)
    }

    func release(_ owner: UUID) {
        claims.removeAll { $0.owner == owner }
    }

    /// SwiftUI's text views have no paste delegate of their own, so nothing is displaced.
    private func install(on view: UITextView?) {
        guard let view else { return }
        editing = view
        bind(view.window)
        if view.pasteDelegate == nil { view.pasteDelegate = self }
    }

    func textPasteConfigurationSupporting(
        _ textPasteConfigurationSupporting: any UITextPasteConfigurationSupporting,
        transform item: any UITextPasteItem
    ) {
        let provider = item.itemProvider
        let window = (textPasteConfigurationSupporting as? UIView)?.window
        guard let claim = claims.last(where: { $0.window != nil && $0.window === window }),
              provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) else {
            return item.setDefaultResult()
        }
        item.setNoResult()
        // One paste can bring several images, each its own item; they go to the owner as one load.
        if pending.isEmpty {
            DispatchQueue.main.async { [weak self] in self?.flush(to: claim.handler) }
        }
        pending.append(provider)
    }

    private func flush(to handler: (@escaping ImageLoad) -> Void) {
        let providers = pending
        pending = []
        handler { await PastedImages.load(providers) }
    }
}
