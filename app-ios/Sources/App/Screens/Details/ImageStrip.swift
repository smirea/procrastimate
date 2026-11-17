import Core
import QuickLook
import Feedback
import SwiftUI

/// A task's attachments in details: image thumbnails that open full screen, file tiles that open in Quick Look, and an
/// add tile with the photo library, the camera, the pasteboard, and the file importer. A read-only task shows only the
/// attachments.
struct ImageStrip: View {
    @Environment(TaskAttachments.self) private var attachments
    @Environment(\.imageZoom) private var zoom
    @Environment(\.space) private var space
    let task: TaskItem
    let locked: Bool

    @State private var source: ImageSource?
    @State private var previewing: URL?

    /// The task's attachments, then the ones still being kept on the device, which show before the task lists them.
    private var tiles: [(attachment: Attachment, adding: Bool)] {
        let listed = Set(task.attachments.map(\.id))
        let adding = (attachments.adding[task.id] ?? []).filter { !listed.contains($0.id) }
        return task.attachments.map { ($0, false) } + adding.map { ($0, true) }
    }

    var body: some View {
        let images = task.attachments.compactMap(\.image)
        let tiles = tiles
        if !tiles.isEmpty || !locked {
            FlowLayout(spacing: 8) {
                ForEach(tiles, id: \.attachment.id) { attachment, adding in
                    Group {
                        switch attachment {
                        case let .image(image) where adding: addingImageTile(image)
                        case let .image(image): imageTile(image, index: images.firstIndex(of: image) ?? 0, count: images.count)
                        case let .file(file): fileTile(file).disabled(adding)
                        }
                    }
                    .contextMenu {
                        if !locked, !adding {
                            Button("Delete", systemImage: "trash", role: .destructive) { attachments.remove(task.id, attachment.id) }
                        }
                    }
                    .transition(.scale(scale: 0.85).combined(with: .opacity))
                }
                if !locked { addTile }
            }
            .animation(.snappy, value: tiles.map(\.attachment.id))
            .imageSource($source) { load in
                Task { await attachments.attach(task.id, await load()) }
            } onFiles: { load in
                Task { await attachments.attach(task.id, files: await load()) }
            }
            .quickLookPreview($previewing)
            .feedback(self)
        }
    }

    private func imageTile(_ image: ImageRef, index: Int, count: Int) -> some View {
        Button {
            attachments.viewing = .init(taskID: task.id, imageID: image.id)
        } label: {
            ImageThumb(image: image, size: .thumb)
                .frame(width: 72, height: 72)
                .clipShape(.rect(cornerRadius: 16))
                .zoomSource(image.id, in: zoom)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Open image \(index + 1) of \(count)")
    }

    /// An image still being encoded: its quick preview, or a quiet tile until that is ready.
    private func addingImageTile(_ image: ImageRef) -> some View {
        Group {
            if let preview = attachments.image(image.id, .thumb) {
                Image(uiImage: preview).resizable().aspectRatio(contentMode: .fill)
            } else {
                Rectangle().fill(.ink.opacity(0.05))
            }
        }
        .frame(width: 72, height: 72)
        .clipShape(.rect(cornerRadius: 16))
        .accessibilityLabel("Adding image")
    }

    private func fileTile(_ file: FileRef) -> some View {
        let kind = FileKinds.kind(name: file.name, type: file.type)
        let size = Format.formatBytes(file.bytes)
        let progress = attachments.progress(file)
        return Button {
            Task { previewing = await attachments.open(file, space: space) }
        } label: {
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline) {
                    ZStack {
                        if attachments.opening.contains(file.id) {
                            ProgressView().controlSize(.small)
                        } else {
                            Image(systemName: kind.systemImage)
                                .font(.title3)
                                .foregroundStyle(kind.color.tone)
                        }
                    }
                    .frame(height: 22)
                    Spacer(minLength: 0)
                    Text(progress.map { "\(Int($0 * 100))% of \(size)" } ?? size)
                        .font(.caption2)
                        .monospacedDigit()
                        .foregroundStyle(.muted)
                        .contentTransition(.numericText())
                }
                Spacer(minLength: 0)
                Text(file.name)
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(.ink)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(8)
            .frame(width: 112, height: 72, alignment: .leading)
            .background(kind.color.fill.opacity(0.5), in: .rect(cornerRadius: 16))
            .overlay(alignment: .bottomLeading) {
                if let progress {
                    Rectangle()
                        .fill(.accent)
                        .frame(width: 112 * progress, height: 2)
                        .animation(.snappy, value: progress)
                        .accessibilityLabel("Uploading \(file.name)")
                        .accessibilityValue("\(Int(progress * 100)) percent")
                }
            }
            .clipShape(.rect(cornerRadius: 16))
            .contentShape(.rect(cornerRadius: 16))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Open \(file.name), \(size)")
    }

    private var addTile: some View {
        Menu {
            ImageSourceButtons { source = $0 }
        } label: {
            RoundedRectangle(cornerRadius: 16)
                .strokeBorder(.ink.opacity(0.16), style: StrokeStyle(lineWidth: 1.5, dash: [5, 4]))
                .frame(width: 72, height: 72)
                .overlay {
                    Image(systemName: "paperclip")
                        .font(.title3)
                        .foregroundStyle(.muted)
                }
                .contentShape(.rect(cornerRadius: 16))
        }
        .accessibilityLabel("Add attachment")
    }
}

/// One image's bytes, fetched once and cached, with a quiet placeholder until they arrive.
struct ImageThumb: View {
    @Environment(TaskAttachments.self) private var images
    let image: ImageRef
    let size: TaskAttachments.Size

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
        .loadsImage(image.id, size)
        .feedback(self)
    }
}

extension View {
    /// Loads an image's bytes into `TaskAttachments`, the thumbnail first for a full image, asking again while the
    /// server does not have them yet.
    func loadsImage(_ id: String, _ size: TaskAttachments.Size) -> some View {
        modifier(ImageLoader(id: id, size: size))
    }
}

private struct ImageLoader: ViewModifier {
    @Environment(TaskAttachments.self) private var images
    @Environment(\.space) private var space
    let id: String
    let size: TaskAttachments.Size

    func body(content: Content) -> some View {
        content.task(id: id) {
            if size == .full { await images.load(id, .thumb, space: space) }
            while !Task.isCancelled, await !images.load(id, size, space: space) {
                try? await Task.sleep(for: TaskAttachments.retryMissing)
            }
        }
    }
}
