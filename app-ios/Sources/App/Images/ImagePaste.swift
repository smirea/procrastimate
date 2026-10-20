import UIKit
import UniformTypeIdentifiers

/// Takes the images of a paste into a text view, through the text view's own paste, and hands them to the focused smart
/// input's owner. SwiftUI's `TextEditor` keeps only U+FFFC from an image paste, and reading the image back from
/// `UIPasteboard` afterwards shows the system "Allow Paste" prompt on every paste. A paste delegate receives the items the
/// user chose to paste, which needs no permission.
@MainActor
final class ImagePaste: NSObject, UITextPasteDelegate {
    static let shared = ImagePaste()

    private var owner: UUID?
    private var handler: ((@escaping ImageLoad) -> Void)?
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
        self.owner = owner
        self.handler = handler
    }

    func release(_ owner: UUID) {
        guard self.owner == owner else { return }
        self.owner = nil
        handler = nil
    }

    /// SwiftUI's text views have no paste delegate of their own, so nothing is displaced.
    private func install(on view: UITextView?) {
        guard let view, view.pasteDelegate == nil else { return }
        view.pasteDelegate = self
    }

    func textPasteConfigurationSupporting(
        _ textPasteConfigurationSupporting: any UITextPasteConfigurationSupporting,
        transform item: any UITextPasteItem
    ) {
        let provider = item.itemProvider
        guard handler != nil, provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) else {
            return item.setDefaultResult()
        }
        item.setNoResult()
        // One paste can bring several images, each its own item; they go to the owner as one load.
        if pending.isEmpty {
            DispatchQueue.main.async { [weak self] in self?.flush() }
        }
        pending.append(provider)
    }

    private func flush() {
        let providers = pending
        pending = []
        handler? { await PastedImages.load(providers) }
    }
}
