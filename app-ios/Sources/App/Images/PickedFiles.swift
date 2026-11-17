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
    func data() -> Data? { try? Data(contentsOf: url, options: .mappedIfSafe) }

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
                let copy = URL.temporaryDirectory
                    .appending(path: "picked/\(UUID().uuidString)", directoryHint: .isDirectory)
                    .appending(path: name)
                do {
                    try FileManager.default.createDirectory(at: copy.deletingLastPathComponent(), withIntermediateDirectories: true)
                    try FileManager.default.copyItem(at: url, to: copy)
                } catch {
                    return .failure(.unreadable)
                }
                let bytes = (try? copy.resourceValues(forKeys: [.fileSizeKey]))?.fileSize ?? 0
                if bytes == 0 { return .failure(.empty) }
                if bytes > FileKinds.maxBytes { return .failure(.tooLarge) }
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
