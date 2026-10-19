import PhotosUI
import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// Where a new image comes from. Task details and quick add offer the same three.
enum ImageSource { case library, camera, paste }

/// The image sources as menu items. The camera shows only on a device that has one.
struct ImageSourceButtons: View {
    let pick: (ImageSource) -> Void

    var body: some View {
        Button("Photo Library", systemImage: "photo.on.rectangle") { pick(.library) }
        if UIImagePickerController.isSourceTypeAvailable(.camera) {
            Button("Take Photo", systemImage: "camera") { pick(.camera) }
        }
        // Not disabled by `hasImages`: the menu is built before the user copies, so it would stay stale.
        Button("Paste", systemImage: "doc.on.clipboard") { pick(.paste) }
    }
}

extension View {
    /// Presents the source `source` names, then hands over the bytes of each image it gave.
    func imageSource(_ source: Binding<ImageSource?>, onImages: @escaping ([Data]) -> Void) -> some View {
        modifier(ImageSourcePresenter(source: source, onImages: onImages))
    }

}

/// Reads pasted images as the bytes they were copied as. Decoding and re-encoding them here, on the main actor, froze
/// the app for seconds on a full-size photo; `ImageEncoder` does that work off it.
@MainActor
enum PastedImages {
    static func fromPasteboard() async -> [Data] {
        var sources: [Data] = []
        for provider in UIPasteboard.general.itemProviders where provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
            let data: Data? = await withCheckedContinuation { continuation in
                _ = provider.loadDataRepresentation(for: .image) { data, _ in continuation.resume(returning: data) }
            }
            if let data { sources.append(data) }
        }
        return sources
    }

}

private struct ImageSourcePresenter: ViewModifier {
    @Environment(Toasts.self) private var toasts
    @Binding var source: ImageSource?
    let onImages: ([Data]) -> Void
    @State private var picked: [PhotosPickerItem] = []

    func body(content: Content) -> some View {
        content
            .photosPicker(isPresented: presenting(.library), selection: $picked, maxSelectionCount: 10, matching: .images)
            .fullScreenCover(isPresented: presenting(.camera)) {
                CameraPicker { onImages([$0]) }
                    .ignoresSafeArea()
            }
            .onChange(of: source) {
                guard source == .paste else { return }
                source = nil
                Task {
                    let sources = await PastedImages.fromPasteboard()
                    if sources.isEmpty { toasts.show("No image to paste", for: .seconds(2)) } else { onImages(sources) }
                }
            }
            .onChange(of: picked) {
                let items = picked
                picked = []
                guard !items.isEmpty else { return }
                Task {
                    var sources: [Data] = []
                    var failed = 0
                    for item in items {
                        do {
                            if let data = try await item.loadTransferable(type: Data.self) { sources.append(data) } else { failed += 1 }
                        } catch {
                            ErrorReport.log("Could not load a picked photo", error: error)
                            failed += 1
                        }
                    }
                    if failed > 0 { toasts.show("Couldn’t add \(failed) image\(failed == 1 ? "" : "s")") }
                    if !sources.isEmpty { onImages(sources) }
                }
            }
    }

    private func presenting(_ kind: ImageSource) -> Binding<Bool> {
        Binding(get: { source == kind }, set: { if !$0, source == kind { source = nil } })
    }
}

/// The system camera, which SwiftUI has no view for.
private struct CameraPicker: UIViewControllerRepresentable {
    let onShot: (Data) -> Void
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_: UIImagePickerController, context _: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: CameraPicker

        init(_ parent: CameraPicker) { self.parent = parent }

        func imagePickerController(_: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if let image = info[.originalImage] as? UIImage {
                let onShot = parent.onShot
                Task {
                    let data = await Task.detached(priority: .userInitiated) { image.jpegData(compressionQuality: 0.95) }.value
                    if let data { onShot(data) }
                }
            }
            parent.dismiss()
        }

        func imagePickerControllerDidCancel(_: UIImagePickerController) { parent.dismiss() }
    }
}
