import Core
import QuickLook
import Feetback
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

    private var adding: Int { attachments.adding[task.id] ?? 0 }

    var body: some View {
        let images = task.attachments.compactMap(\.image)
        if !task.attachments.isEmpty || adding > 0 || !locked {
            FlowLayout(spacing: 8) {
                ForEach(task.attachments) { attachment in
                    Group {
                        switch attachment {
                        case let .image(image): imageTile(image, index: images.firstIndex(of: image) ?? 0, count: images.count)
                        case let .file(file): fileTile(file)
                        }
                    }
                    .contextMenu {
                        if !locked {
                            Button("Delete", systemImage: "trash", role: .destructive) { attachments.remove(task.id, attachment.id) }
                        }
                    }
                    .transition(.scale(scale: 0.85).combined(with: .opacity))
                }
                ForEach(0 ..< adding, id: \.self) { _ in
                    RoundedRectangle(cornerRadius: 16)
                        .fill(.ink.opacity(0.06))
                        .frame(width: 72, height: 72)
                        .overlay { ProgressView() }
                        .accessibilityLabel("Adding attachment")
                }
                if !locked { addTile }
            }
            .animation(.snappy, value: task.attachments)
            .animation(.snappy, value: adding)
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

    private func fileTile(_ file: FileRef) -> some View {
        let kind = FileKinds.kind(name: file.name, type: file.type)
        let size = Format.formatBytes(file.bytes)
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
                    Text(size)
                        .font(.caption2)
                        .foregroundStyle(.muted)
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
    @Environment(\.space) private var space
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
        .task(id: image.id) {
            if size == .full { await images.load(image.id, .thumb, space: space) }
            while !Task.isCancelled, await !images.load(image.id, size, space: space) {
                try? await Task.sleep(for: TaskAttachments.retryMissing)
            }
        }
        .feedback(self)
    }
}
