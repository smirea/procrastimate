import Core
import Foundation
import ImageIO
import UniformTypeIdentifiers

/// Downscales a picked, shot, or pasted image to the full size and a thumbnail, upright per its EXIF and without its
/// metadata. iOS has no WebP encoder, so both are JPEG. The limits are `shared/images.ts`'s.
enum ImageEncoder {
    struct Encoded {
        let width: Int
        let height: Int
        let full: Data
        let thumb: Data
    }

    enum Failure: Error { case unreadable, tooLarge }

    static let full = (edge: 2048, bytes: 1_500_000)
    static let thumb = (edge: 320, bytes: 200_000)
    private static let qualities: [Double] = [0.85, 0.75, 0.6, 0.45]

    static func encode(_ data: Data) throws -> Encoded {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { throw Failure.unreadable }
        let (full, width, height) = try fit(source, edge: full.edge, bytes: full.bytes)
        let (thumb, _, _) = try fit(source, edge: thumb.edge, bytes: thumb.bytes)
        return Encoded(width: width, height: height, full: full, thumb: thumb)
    }

    /// The first JPEG under `bytes`, at falling quality, then at a smaller scale.
    private static func fit(_ source: CGImageSource, edge: Int, bytes: Int) throws -> (Data, Int, Int) {
        var edge = edge
        while edge >= 64 {
            let options: [CFString: Any] = [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: edge,
            ]
            guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else {
                throw Failure.unreadable
            }
            for quality in qualities {
                if let data = jpeg(image, quality: quality), data.count <= bytes { return (data, image.width, image.height) }
            }
            edge = edge * 3 / 4
        }
        throw Failure.tooLarge
    }

    private static func jpeg(_ image: CGImage, quality: Double) -> Data? {
        let data = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(data, UTType.jpeg.identifier as CFString, 1, nil) else {
            return nil
        }
        CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
        return CGImageDestinationFinalize(destination) ? data as Data : nil
    }
}
