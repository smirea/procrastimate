import Foundation

/// What a file attachment is, for its icon, and how it is split for the server. Mirrors `shared/images.ts`, whose
/// tests record the vectors `VectorTests` replays.
public enum FileKind: String, CaseIterable, Sendable {
    case pdf, document, spreadsheet, presentation, archive, audio, video, image, code, text, other

    /// The icon's tint, from the label palette, as on the web.
    public var color: LabelColor {
        LabelColor(rawValue: SharedConstants.FileKindColors.all[rawValue] ?? "") ?? .gray
    }
}

public enum FileKinds {
    /// Each part fits one server row, under the 2 MB a Durable Object row holds.
    public static let partBytes = SharedConstants.filePartBytes
    public static let maxBytes = SharedConstants.fileMaxBytes
    /// The server stores and answers every part as opaque bytes.
    public static let partType = SharedConstants.filePartType

    public static func partCount(_ bytes: Int) -> Int { max(1, (bytes + partBytes - 1) / partBytes) }

    /// The extension decides first, since many files come with an empty or generic type.
    public static func kind(name: String, type: String) -> FileKind {
        let dot = name.lastIndex(of: ".")
        let ext = dot.map { $0 == name.startIndex ? "" : String(name[name.index(after: $0)...]).lowercased() } ?? ""
        if let kind = extensions[ext] { return kind }
        return typePrefixes.first { type.hasPrefix($0.0) }?.1 ?? .other
    }

    private static let extensions: [String: FileKind] = [
        "pdf": .pdf,
        "doc": .document,
        "docx": .document,
        "odt": .document,
        "rtf": .document,
        "pages": .document,
        "xls": .spreadsheet,
        "xlsx": .spreadsheet,
        "ods": .spreadsheet,
        "csv": .spreadsheet,
        "tsv": .spreadsheet,
        "numbers": .spreadsheet,
        "ppt": .presentation,
        "pptx": .presentation,
        "odp": .presentation,
        "key": .presentation,
        "zip": .archive,
        "rar": .archive,
        "7z": .archive,
        "tar": .archive,
        "gz": .archive,
        "tgz": .archive,
        "bz2": .archive,
        "xz": .archive,
        "dmg": .archive,
        "mp3": .audio,
        "m4a": .audio,
        "wav": .audio,
        "aac": .audio,
        "flac": .audio,
        "ogg": .audio,
        "opus": .audio,
        "mp4": .video,
        "mov": .video,
        "m4v": .video,
        "webm": .video,
        "mkv": .video,
        "avi": .video,
        "png": .image,
        "jpg": .image,
        "jpeg": .image,
        "gif": .image,
        "webp": .image,
        "heic": .image,
        "heif": .image,
        "svg": .image,
        "tif": .image,
        "tiff": .image,
        "bmp": .image,
        "js": .code,
        "ts": .code,
        "jsx": .code,
        "tsx": .code,
        "json": .code,
        "html": .code,
        "css": .code,
        "py": .code,
        "rb": .code,
        "go": .code,
        "rs": .code,
        "swift": .code,
        "kt": .code,
        "java": .code,
        "c": .code,
        "h": .code,
        "cpp": .code,
        "sh": .code,
        "sql": .code,
        "xml": .code,
        "yaml": .code,
        "yml": .code,
        "toml": .code,
        "txt": .text,
        "md": .text,
        "log": .text,
    ]

    private static let typePrefixes: [(String, FileKind)] = [
        ("application/pdf", .pdf),
        ("audio/", .audio),
        ("video/", .video),
        ("image/", .image),
        ("text/", .text),
        ("application/zip", .archive),
        ("application/json", .code),
    ]
}
