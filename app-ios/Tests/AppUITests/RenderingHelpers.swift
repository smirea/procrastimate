import XCTest

/// Reads what is drawn rather than what the accessibility tree says: highlight tints and background colors.
extension ParityTestCase {
    /// The phrases the focused smart input renders tinted, read back from its text storage (DEBUG builds only).
    var renderedHighlights: XCUIElement {
        app.descendants(matching: .any).matching(identifier: "Rendered highlights").firstMatch
    }

    func expectRendered(_ text: String) {
        wait(for: renderedHighlights, "label CONTAINS '\(text)'")
    }

    /// The color at a point of the screen, in points.
    func pixel(at point: CGPoint) -> (r: Int, g: Int, b: Int) {
        guard let image = XCUIScreen.main.screenshot().image.cgImage else { return (0, 0, 0) }
        let scale = CGFloat(image.width) / app.frame.width
        let x = Int(point.x * scale), y = Int(point.y * scale)
        guard let crop = image.cropping(to: CGRect(x: x, y: y, width: 1, height: 1)) else { return (0, 0, 0) }
        var bytes = [UInt8](repeating: 0, count: 4)
        bytes.withUnsafeMutableBytes { buffer in
            let context = CGContext(
                data: buffer.baseAddress, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4,
                space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
            )
            context?.draw(crop, in: CGRect(x: 0, y: 0, width: 1, height: 1))
        }
        return (Int(bytes[0]), Int(bytes[1]), Int(bytes[2]))
    }
}
