import Core
import Feetback
import SwiftUI

extension EnvironmentValues {
    /// The namespace the viewer zooms out of and back into, set by the details sheet that presents it.
    @Entry var imageZoom: Namespace.ID?
}

extension View {
    /// A thumbnail the viewer zooms out of. The zoom transition is also what lets a swipe down close the viewer.
    @ViewBuilder
    func zoomSource(_ imageID: String, in zoom: Namespace.ID?) -> some View {
        if let zoom {
            matchedTransitionSource(id: imageID, in: zoom) { $0.clipShape(.rect(cornerRadius: 16)) }
        } else {
            self
        }
    }
}

/// A task's images full screen, swiped through like Photos, zoomed and panned in a scroll view, swiped down to close,
/// shared or copied as the full-size image, with delete on an editable task.
struct ImageViewer: View {
    @Environment(TaskAttachments.self) private var images
    @Environment(Store.self) private var store
    @Environment(\.dismiss) private var dismiss
    let start: TaskAttachments.Viewing

    @State private var current: String

    init(start: TaskAttachments.Viewing) {
        self.start = start
        _current = State(initialValue: start.imageID)
    }

    var body: some View {
        let task = store.task(start.taskID)
        let list = task?.attachments.compactMap(\.image) ?? []
        let index = list.firstIndex { $0.id == current }
        ZStack(alignment: .top) {
            Color.black.ignoresSafeArea()
            TabView(selection: $current) {
                ForEach(list) { image in
                    ZoomableImage(image: image).tag(image.id)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            .ignoresSafeArea()
            HStack {
                if let index, list.count > 1 {
                    Text("\(index + 1) of \(list.count)")
                        .font(.subheadline.monospacedDigit())
                        .foregroundStyle(.white.opacity(0.75))
                }
                Spacer()
                if let task, !store.isReadOnly(task.id) {
                    Button("Delete image", systemImage: "trash") { images.remove(task.id, current) }
                        .labelStyle(.iconOnly)
                        .buttonStyle(.glass)
                }
                share
                Button("Close image", systemImage: "xmark") { dismiss() }
                    .labelStyle(.iconOnly)
                    .buttonStyle(.glass)
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
        }
        .environment(\.colorScheme, .dark)
        .onChange(of: list) {
            if list.isEmpty { dismiss() } else if !list.contains(where: { $0.id == current }) { current = list[0].id }
        }
        .feedback(self)
    }

    /// Shares the full-size image, never the thumbnail, so it waits for those bytes.
    @ViewBuilder
    private var share: some View {
        if let full = images.image(current, .full) {
            ShareLink(item: SharedImage(image: full), preview: SharePreview("Image", image: Image(uiImage: full))) {
                Label("Share image", systemImage: "square.and.arrow.up")
            }
            .labelStyle(.iconOnly)
            .buttonStyle(.glass)
        } else {
            Button("Share image", systemImage: "square.and.arrow.up") {}
                .labelStyle(.iconOnly)
                .buttonStyle(.glass)
                .disabled(true)
        }
    }
}

/// The image as the share sheet hands it on: JPEG bytes, so the sheet offers Save Image and Copy. Images the web
/// attached are stored as WebP, so the bytes are encoded here rather than passed on as stored.
private struct SharedImage: Transferable {
    let image: UIImage

    static var transferRepresentation: some TransferRepresentation {
        DataRepresentation(exportedContentType: .jpeg) { shared in
            guard let data = shared.image.jpegData(compressionQuality: 0.95) else { throw CocoaError(.fileWriteUnknown) }
            return data
        }
    }
}

private struct ZoomableImage: View {
    @Environment(TaskAttachments.self) private var images
    let image: ImageRef

    var body: some View {
        let full = images.image(image.id, .full)
        Group {
            if let shown = full ?? images.image(image.id, .thumb) {
                ZoomingImage(image: shown, full: full != nil)
            } else {
                ProgressView().tint(.white)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .loadsImage(image.id, .full)
    }
}

/// Photos' zooming: a scroll view pinches, pans with bounce, and double-taps to zoom, which SwiftUI has no view for.
/// At full size the image fits and the scroll view cannot scroll, so its pan gives way to the page swipe and to the
/// swipe down that closes the viewer. A long press lifts the image with Copy and Share, as in Photos and Messages.
private struct ZoomingImage: UIViewRepresentable {
    let image: UIImage
    let full: Bool

    func makeUIView(context _: Context) -> ZoomingImageView { ZoomingImageView() }

    func updateUIView(_ view: ZoomingImageView, context _: Context) { view.show(image, full: full) }
}

final class ZoomingImageView: UIScrollView, UIScrollViewDelegate, UIContextMenuInteractionDelegate {
    private let imageView = UIImageView()
    private var full = false
    private var fitted: CGSize = .zero

    init() {
        super.init(frame: .zero)
        delegate = self
        maximumZoomScale = 4
        showsVerticalScrollIndicator = false
        showsHorizontalScrollIndicator = false
        contentInsetAdjustmentBehavior = .never
        decelerationRate = .fast
        imageView.isUserInteractionEnabled = true
        imageView.isAccessibilityElement = true
        imageView.accessibilityLabel = "Image"
        imageView.accessibilityTraits = .image
        imageView.addInteraction(UIContextMenuInteraction(delegate: self))
        addSubview(imageView)
        let doubleTap = UITapGestureRecognizer(target: self, action: #selector(toggleZoom))
        doubleTap.numberOfTapsRequired = 2
        addGestureRecognizer(doubleTap)
    }

    @available(*, unavailable)
    required init?(coder _: NSCoder) { fatalError("init(coder:) is not supported") }

    /// The full image replaces the thumbnail in place, keeping the zoom, since both have the same shape.
    func show(_ image: UIImage, full: Bool) {
        self.full = full
        guard imageView.image !== image else { return }
        let before = imageView.image.map { $0.size.width / $0.size.height }
        imageView.image = image
        if let before, abs(before - image.size.width / image.size.height) < 0.01 { return }
        fitted = .zero
        setNeedsLayout()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        guard let image = imageView.image, image.size.width > 0, image.size.height > 0, bounds.size != fitted else { return }
        let scale = min(bounds.width / image.size.width, bounds.height / image.size.height)
        zoomScale = 1
        imageView.frame = CGRect(origin: .zero, size: CGSize(width: image.size.width * scale, height: image.size.height * scale))
        contentSize = imageView.frame.size
        fitted = bounds.size
        center()
    }

    func viewForZooming(in _: UIScrollView) -> UIView? { imageView }

    func scrollViewDidZoom(_: UIScrollView) { center() }

    private func center() {
        let horizontal = max((bounds.width - imageView.frame.width) / 2, 0)
        let vertical = max((bounds.height - imageView.frame.height) / 2, 0)
        contentInset = UIEdgeInsets(top: vertical, left: horizontal, bottom: vertical, right: horizontal)
    }

    @objc private func toggleZoom(_ tap: UITapGestureRecognizer) {
        if zoomScale > minimumZoomScale {
            setZoomScale(minimumZoomScale, animated: true)
            return
        }
        let point = tap.location(in: imageView)
        let scale = min(maximumZoomScale, 2.5)
        let size = CGSize(width: bounds.width / scale, height: bounds.height / scale)
        zoom(to: CGRect(x: point.x - size.width / 2, y: point.y - size.height / 2, width: size.width, height: size.height), animated: true)
    }

    func contextMenuInteraction(_: UIContextMenuInteraction, configurationForMenuAtLocation _: CGPoint) -> UIContextMenuConfiguration? {
        guard full, let image = imageView.image else { return nil }
        return UIContextMenuConfiguration(actionProvider: { [weak self] _ in
            UIMenu(children: [
                UIAction(title: "Copy", image: UIImage(systemName: "doc.on.doc")) { _ in UIPasteboard.general.image = image },
                UIAction(title: "Share…", image: UIImage(systemName: "square.and.arrow.up")) { _ in self?.share(image) },
            ])
        })
    }

    private func share(_ image: UIImage) {
        var top = window?.rootViewController
        while let presented = top?.presentedViewController { top = presented }
        let sheet = UIActivityViewController(activityItems: [image], applicationActivities: nil)
        sheet.popoverPresentationController?.sourceView = imageView
        top?.present(sheet, animated: true)
    }
}
