import Core
import Foundation
import SwiftUI
import UniformTypeIdentifiers

/// A file the file importer gave, read into memory while its security scope was open.
struct PickedFile: Sendable, Identifiable, Equatable {
    let id = UUID()
    let name: String
    /// The MIME type, empty when the system knows none.
    let type: String
    let data: Data

    var isImage: Bool { UTType(mimeType: type)?.conforms(to: .image) ?? false }
    var kind: FileKind { FileKinds.kind(name: name, type: type) }

    static func == (a: PickedFile, b: PickedFile) -> Bool { a.id == b.id }
}

/// Reads picked files. A source hands this over as soon as it is chosen, so the receiver can show a placeholder.
typealias FileLoad = @MainActor () async -> [PickedFile]

@MainActor
enum PickedFiles {
    /// Reads each file off the main actor, refusing empty ones and ones over `FileKinds.maxBytes` with a toast.
    static func load(_ urls: [URL], toasts: Toasts) async -> [PickedFile] {
        var files: [PickedFile] = []
        for url in urls {
            let name = url.lastPathComponent
            let read = await Task.detached(priority: .userInitiated) { () -> Result<PickedFile, Refusal> in
                let scoped = url.startAccessingSecurityScopedResource()
                defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                let values = try? url.resourceValues(forKeys: [.fileSizeKey, .contentTypeKey])
                if let size = values?.fileSize, size > FileKinds.maxBytes { return .failure(.tooLarge) }
                guard let data = try? Data(contentsOf: url) else { return .failure(.unreadable) }
                if data.isEmpty { return .failure(.empty) }
                if data.count > FileKinds.maxBytes { return .failure(.tooLarge) }
                let type = (values?.contentType ?? UTType(filenameExtension: url.pathExtension))?.preferredMIMEType ?? ""
                return .success(PickedFile(name: name, type: type, data: data))
            }.value
            switch read {
            case let .success(file): files.append(file)
            case .failure(.tooLarge): toasts.show("\(name) is over \(FileKinds.maxBytes / 1_000_000) MB")
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
