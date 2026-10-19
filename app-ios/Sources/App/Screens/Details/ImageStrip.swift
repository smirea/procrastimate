import Core
import SwiftUI

/// A task's images in details: thumbnails that open full screen, and an add tile with the photo library, the camera,
/// and the pasteboard. A read-only task shows only the thumbnails.
struct ImageStrip: View {
    @Environment(TaskImages.self) private var images
    @Environment(\.imageZoom) private var zoom
    let task: TaskItem
    let locked: Bool

    @State private var source: ImageSource?

    private var adding: Int { images.adding[task.id] ?? 0 }

    var body: some View {
        if !task.images.isEmpty || adding > 0 || !locked {
            FlowLayout(spacing: 8) {
                ForEach(Array(task.images.enumerated()), id: \.element.id) { index, image in
                    Button {
                        images.viewing = .init(taskID: task.id, imageID: image.id)
                    } label: {
                        ImageThumb(image: image, size: .thumb)
                            .frame(width: 72, height: 72)
                            .clipShape(.rect(cornerRadius: 16))
                            .zoomSource(image.id, in: zoom)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Open image \(index + 1) of \(task.images.count)")
                    .contextMenu {
                        if !locked {
                            Button("Delete", systemImage: "trash", role: .destructive) { images.remove(task.id, image.id) }
                        }
                    }
                    .transition(.scale(scale: 0.85).combined(with: .opacity))
                }
                ForEach(0 ..< adding, id: \.self) { _ in
                    RoundedRectangle(cornerRadius: 16)
                        .fill(.ink.opacity(0.06))
                        .frame(width: 72, height: 72)
                        .overlay { ProgressView() }
                        .accessibilityLabel("Adding image")
                }
                if !locked { addTile }
            }
            .animation(.snappy, value: task.images)
            .animation(.snappy, value: adding)
            .imageSource($source) { sources in Task { await images.attach(task.id, sources) } }
        }
    }

    private var addTile: some View {
        Menu {
            ImageSourceButtons { source = $0 }
        } label: {
            RoundedRectangle(cornerRadius: 16)
                .strokeBorder(.ink.opacity(0.16), style: StrokeStyle(lineWidth: 1.5, dash: [5, 4]))
                .frame(width: 72, height: 72)
                .overlay {
                    Image(systemName: "photo.badge.plus")
                        .font(.title3)
                        .foregroundStyle(.muted)
                }
                .contentShape(.rect(cornerRadius: 16))
        }
        .accessibilityLabel("Add image")
    }
}

/// One image's bytes, fetched once and cached, with a quiet placeholder until they arrive.
struct ImageThumb: View {
    @Environment(TaskImages.self) private var images
    @Environment(\.space) private var space
    let image: ImageRef
    let size: TaskImages.Size

    var body: some View {
        Group {
            if let loaded = images.image(image.id, size) ?? (size == .full ? images.image(image.id, .thumb) : nil) {
                Image(uiImage: loaded)
                    .resizable()
                    .aspectRatio(contentMode: size == .thumb ? .fill : .fit)
            } else {
                Rectangle()
                    .fill(.ink.opacity(0.05))
                    .aspectRatio(CGFloat(image.width) / CGFloat(image.height), contentMode: size == .thumb ? .fill : .fit)
                    .overlay { Image(systemName: "photo").foregroundStyle(.faint) }
            }
        }
        .task(id: image.id) {
            if size == .full { await images.load(image.id, .thumb, space: space) }
            while !Task.isCancelled, await !images.load(image.id, size, space: space) {
                try? await Task.sleep(for: TaskImages.retryMissing)
            }
        }
    }
}
