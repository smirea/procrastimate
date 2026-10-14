import Compression
import Foundation

/// Reads the files in a zip archive, the small subset Todoist backups use: stored or DEFLATE entries listed in the
/// central directory, without ZIP64 or encryption. `Compression` exists only on Apple platforms, so this lives in the
/// app and `Core` takes the extracted files.
enum ZipReader {
    struct Entry {
        let name: String
        let data: Data
    }

    enum Failure: Error {
        case notAZip
        case unsupported(String)
        case corrupt(String)
    }

    private static let endOfCentralDirectory: UInt32 = 0x0605_4B50
    private static let centralDirectoryHeader: UInt32 = 0x0201_4B50
    private static let localFileHeader: UInt32 = 0x0403_4B50

    static func entries(of archive: Data, include: (String) -> Bool = { _ in true }) throws(Failure) -> [Entry] {
        let bytes = [UInt8](archive)
        let end = try findEndOfCentralDirectory(bytes)
        let count = Int(bytes.uint16(at: end + 10))
        var offset = Int(bytes.uint32(at: end + 16))
        var entries: [Entry] = []
        for _ in 0..<count {
            guard offset + 46 <= bytes.count, bytes.uint32(at: offset) == centralDirectoryHeader else {
                throw .corrupt("central directory")
            }
            let flags = bytes.uint16(at: offset + 8)
            let method = bytes.uint16(at: offset + 10)
            let compressedSize = Int(bytes.uint32(at: offset + 20))
            let size = Int(bytes.uint32(at: offset + 24))
            let nameLength = Int(bytes.uint16(at: offset + 28))
            let extraLength = Int(bytes.uint16(at: offset + 30))
            let commentLength = Int(bytes.uint16(at: offset + 32))
            let localOffset = Int(bytes.uint32(at: offset + 42))
            guard offset + 46 + nameLength <= bytes.count else { throw .corrupt("entry name") }
            let name = String(decoding: bytes[(offset + 46)..<(offset + 46 + nameLength)], as: UTF8.self)
            offset += 46 + nameLength + extraLength + commentLength

            if name.hasSuffix("/") || !include(name) { continue }
            if flags & 1 != 0 { throw .unsupported("encrypted entry \(name)") }
            if compressedSize == 0xFFFF_FFFF || size == 0xFFFF_FFFF || localOffset == 0xFFFF_FFFF {
                throw .unsupported("ZIP64 entry \(name)")
            }
            guard localOffset + 30 <= bytes.count, bytes.uint32(at: localOffset) == localFileHeader else {
                throw .corrupt("local header of \(name)")
            }
            let start = localOffset + 30 + Int(bytes.uint16(at: localOffset + 26)) + Int(bytes.uint16(at: localOffset + 28))
            guard start + compressedSize <= bytes.count else { throw .corrupt("data of \(name)") }
            let compressed = bytes[start..<(start + compressedSize)]
            switch method {
            case 0:
                entries.append(Entry(name: name, data: Data(compressed)))
            case 8:
                entries.append(Entry(name: name, data: try inflate(compressed, size: size, name: name)))
            default:
                throw .unsupported("compression method \(method) in \(name)")
            }
        }
        return entries
    }

    /// The record sits at the very end, after an optional comment of up to 65,535 bytes.
    private static func findEndOfCentralDirectory(_ bytes: [UInt8]) throws(Failure) -> Int {
        guard bytes.count >= 22 else { throw .notAZip }
        var offset = bytes.count - 22
        let floor = max(0, bytes.count - 22 - 65_535)
        while offset >= floor {
            if bytes.uint32(at: offset) == endOfCentralDirectory { return offset }
            offset -= 1
        }
        throw .notAZip
    }

    /// Raw DEFLATE, which `COMPRESSION_ZLIB` decodes without a zlib header.
    private static func inflate(_ compressed: ArraySlice<UInt8>, size: Int, name: String) throws(Failure) -> Data {
        if size == 0 { return Data() }
        var output = [UInt8](repeating: 0, count: size)
        let written = compressed.withUnsafeBufferPointer { source in
            compression_decode_buffer(&output, size, source.baseAddress!, source.count, nil, COMPRESSION_ZLIB)
        }
        guard written == size else { throw .corrupt("compressed data of \(name)") }
        return Data(output)
    }
}

private extension [UInt8] {
    func uint16(at offset: Int) -> UInt16 {
        UInt16(self[offset]) | UInt16(self[offset + 1]) << 8
    }

    func uint32(at offset: Int) -> UInt32 {
        UInt32(self[offset]) | UInt32(self[offset + 1]) << 8 | UInt32(self[offset + 2]) << 16 | UInt32(self[offset + 3]) << 24
    }
}
