import Core
import Foundation
import SwiftUI
import UniformTypeIdentifiers

/// A file the file importer gave, as the app's own copy, made while its security scope was open. It is never read
/// into memory whole, so a file of any size attaches.
struct PickedFile: Sendable, Identifiable, Equatable {
    let id = UUID()
    let name: String
    /// The MIME type, empty when the system knows none.
    let type: String
    let url: URL
    let bytes: Int

    var isImage: Bool { UTType(mimeType: type)?.conforms(to: .image) ?? false }
    var kind: FileKind { FileKinds.kind(name: name, type: type) }

    /// The whole file, for the image path, which decodes a picture.
    func data() -> Data? { try? Data(contentsOf: url) }

    /// Removes the copy. Whoever holds a picked file calls this once it is done with it: attached, turned into an
    /// image, or dropped from a draft. A file moved into the upload queue has already left the folder.
    func discard() {
        try? FileManager.default.removeItem(at: url.deletingLastPathComponent())
    }

    static func == (a: PickedFile, b: PickedFile) -> Bool { a.id == b.id }
}

/// Reads picked files. A source hands this over as soon as it is chosen, so the receiver can show a placeholder.
typealias FileLoad = @MainActor () async -> [PickedFile]

@MainActor
enum PickedFiles {
    /// Copies each file off the main actor, refusing empty ones and ones over `FileKinds.maxBytes` with a toast.
    static func load(_ urls: [URL], toasts: Toasts) async -> [PickedFile] {
        var files: [PickedFile] = []
        for url in urls {
            let name = url.lastPathComponent
            let read = await Task.detached(priority: .userInitiated) { () -> Result<PickedFile, Refusal> in
                let scoped = url.startAccessingSecurityScopedResource()
                defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                let values = try? url.resourceValues(forKeys: [.fileSizeKey, .contentTypeKey])
                if let size = values?.fileSize, size > FileKinds.maxBytes { return .failure(.tooLarge) }
                let copy = folder.appending(path: UUID().uuidString, directoryHint: .isDirectory).appending(path: name)
                do {
                    try FileManager.default.createDirectory(at: copy.deletingLastPathComponent(), withIntermediateDirectories: true)
                    try FileManager.default.copyItem(at: url, to: copy)
                } catch {
                    return .failure(.unreadable)
                }
                let bytes = (try? copy.resourceValues(forKeys: [.fileSizeKey]))?.fileSize ?? 0
                guard bytes > 0, bytes <= FileKinds.maxBytes else {
                    try? FileManager.default.removeItem(at: copy.deletingLastPathComponent())
                    return .failure(bytes == 0 ? .empty : .tooLarge)
                }
                let type = (values?.contentType ?? UTType(filenameExtension: url.pathExtension))?.preferredMIMEType ?? ""
                return .success(PickedFile(name: name, type: type, url: copy, bytes: bytes))
            }.value
            switch read {
            case let .success(file): files.append(file)
            case .failure(.tooLarge): toasts.show("\(name) is over \(Format.formatBytes(FileKinds.maxBytes))")
            case .failure(.empty): toasts.show("\(name) is empty")
            case .failure(.unreadable): toasts.show("Could not read \(name)")
            }
        }
        return files
    }

    enum Refusal: Error { case tooLarge, empty, unreadable }

    private nonisolated static var folder: URL { URL.temporaryDirectory.appending(path: "picked", directoryHint: .isDirectory) }

    /// Removes every copy, at launch: no draft outlives the app, so whatever a crash or a kill left behind is garbage.
    nonisolated static func clear() {
        try? FileManager.default.removeItem(at: folder)
    }
}

extension FileKind {
    var systemImage: String {
        switch self {
        case .pdf: "doc.richtext"
        case .document: "doc.text"
        case .spreadsheet: "tablecells"
        case .presentation: "rectangle.on.rectangle.angled"
        case .archive: "doc.zipper"
        case .audio: "waveform"
        case .video: "film"
        case .image: "photo"
        case .code: "chevron.left.forwardslash.chevron.right"
        case .text: "doc.plaintext"
        case .other: "doc"
        }
    }
}
