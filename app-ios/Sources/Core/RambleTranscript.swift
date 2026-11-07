import Foundation

/// Ports `shared/ramble/transcript.ts`. Offsets are UTF-16, like the transcript's tokens.
extension Ramble {
    /// The committed transcript with the live partial after it, and where the partial starts.
    public static func joinTranscript(_ committed: String, _ partial: String) -> (text: String, partialStart: Int) {
        let tail = partial.trimmingCharacters(in: .whitespacesAndNewlines)
        if committed.isEmpty { return (tail, 0) }
        if tail.isEmpty { return (committed, committed.utf16.count) }
        let gap = committed.hasSuffix(" ") || tail.hasPrefix(" ") ? "" : " "
        return (committed + gap + tail, committed.utf16.count + gap.utf16.count)
    }

    public enum CaptionKind: Hashable, Sendable {
        case metadata(QuickAdd.TokenKind)
        case command
    }

    public struct CaptionPart: Hashable, Sendable {
        public let text: String
        public let kind: CaptionKind?
    }

    private static let metadata: Set<RambleTokenKind> = [.due, .recurrence, .priority, .reminder, .project, .label]

    /// The end of the transcript, cut at a word, split so recognized phrases can be tinted: metadata by its kind, and
    /// spoken commands such as `next task` or `scratch that` as commands.
    public static func caption(_ transcript: String, _ tokens: [RambleToken], limit: Int = 140) -> [CaptionPart] {
        let units = Array(transcript.utf16)
        let slice = { (from: Int, to: Int) in String(decoding: units[from..<to], as: UTF16.self) }
        var from = max(0, units.count - limit)
        if from > 0, let space = units[from...].firstIndex(of: UInt16(UInt8(ascii: " "))) { from = space + 1 }
        var parts: [CaptionPart] = from > 0 ? [CaptionPart(text: "… ", kind: nil)] : []
        var cursor = from
        for token in tokens.sorted(by: { $0.start < $1.start }) where token.end > cursor {
            let start = max(token.start, cursor)
            if start > cursor { parts.append(CaptionPart(text: slice(cursor, start), kind: nil)) }
            let kind: CaptionKind = metadata.contains(token.kind)
                ? QuickAdd.TokenKind(rawValue: token.kind.rawValue).map(CaptionKind.metadata) ?? .command
                : .command
            parts.append(CaptionPart(text: slice(start, token.end), kind: kind))
            cursor = token.end
        }
        if cursor < units.count { parts.append(CaptionPart(text: slice(cursor, units.count), kind: nil)) }
        return parts
    }
}
