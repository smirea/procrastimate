import XCTest

/// Handles for the settings, theme, import, and notifications parity tests, named like the web fixture's helpers.
extension ParityTestCase {
    var springboard: XCUIApplication { XCUIApplication(bundleIdentifier: "com.apple.springboard") }

    func element(_ label: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", label)).firstMatch
    }

    func openSettings() {
        go("Browse")
        app.buttons["Settings"].tap()
        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 5))
    }

    func closeSettings() {
        app.navigationBars["Settings"].buttons["Done"].tap()
        waitGone(app.navigationBars["Settings"])
    }

    func themeOption(_ name: String) -> XCUIElement { app.segmentedControls.buttons[name] }

    /// The theme on screen, read from a pixel of the background at the leading edge, like the web's canvas check.
    func expectTheme(_ theme: String, file: StaticString = #filePath, line: UInt = #line) {
        let dark = theme == "dark"
        var luminance = -1.0
        let deadline = Date().addingTimeInterval(5)
        repeat {
            luminance = backgroundLuminance()
            if dark ? luminance < 0.35 : luminance > 0.75 { return }
            Thread.sleep(forTimeInterval: 0.2)
        } while Date() < deadline
        XCTFail("Expected the \(theme) theme, the background's luminance is \(luminance)", file: file, line: line)
    }

    private func backgroundLuminance() -> Double {
        guard let image = XCUIScreen.main.screenshot().image.cgImage else { return -1 }
        let x = Int(Double(image.width) * 0.02)
        let y = Int(Double(image.height) * 0.6)
        var pixel = [UInt8](repeating: 0, count: 4)
        let drawn: Bool = pixel.withUnsafeMutableBytes { buffer in
            guard let context = CGContext(
                data: buffer.baseAddress, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4,
                space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
            ) else { return false }
            context.draw(image, in: CGRect(x: -x, y: y - image.height + 1, width: image.width, height: image.height))
            return true
        }
        guard drawn else { return -1 }
        return (0.299 * Double(pixel[0]) + 0.587 * Double(pixel[1]) + 0.114 * Double(pixel[2])) / 255
    }

    /// Opens `Import from Todoist` and walks the document picker to the app's folder under On My iPhone, where CI
    /// copies the fixtures, then picks the file whose name starts with `file`.
    func pick(_ file: String, snapping id: String? = nil) {
        app.buttons["Import from Todoist"].tap()
        let target = app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", file)).firstMatch
        let deadline = Date().addingTimeInterval(45)
        while Date() < deadline {
            if target.exists, target.isHittable {
                if let id { snap(id) }
                target.tap()
                return
            }
            for step in ["Procrastimate", "On My iPhone", "Browse"] {
                let candidates = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", step))
                if let hit = candidates.allElementsBoundByIndex.first(where: { $0.isHittable && $0.elementType != .tab }) {
                    hit.tap()
                    break
                }
            }
            Thread.sleep(forTimeInterval: 0.5)
        }
        XCTFail("Never reached \(file) in the document picker")
    }

    var importSummary: XCUIElement { element("Import summary") }

    func openNotifications() {
        go("Browse")
        notificationsRow.tap()
        XCTAssertTrue(app.navigationBars["Notifications"].waitForExistence(timeout: 5))
    }

    var notificationsRow: XCUIElement {
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Notifications'")).firstMatch
    }

    func heading(_ text: String) -> XCUIElement { app.staticTexts[text] }

    /// Turns notifications on, allowing the system prompt the first time the simulator shows it.
    func turnOnNotifications() {
        app.buttons["Turn on notifications"].tap()
        let allow = springboard.alerts.buttons["Allow"]
        if allow.waitForExistence(timeout: 3) { allow.tap() }
        XCTAssertTrue(heading("Notifications are on").waitForExistence(timeout: 5))
    }

    /// The device's pending requests as `title@<ISO time>: body`, from the DEBUG readout on the scheduled count.
    func expectPending(_ lines: [String], file: StaticString = #filePath, line: UInt = #line) {
        let readout = app.staticTexts.matching(NSPredicate(format: "identifier BEGINSWITH 'pending: '")).firstMatch
        let expected = "pending: " + lines.joined(separator: "; ")
        let deadline = Date().addingTimeInterval(5)
        repeat {
            if readout.exists, readout.identifier == expected { return }
            Thread.sleep(forTimeInterval: 0.25)
        } while Date() < deadline
        XCTFail("Pending is \(readout.exists ? readout.identifier : "missing"), expected \(expected)", file: file, line: line)
    }

    func toast(_ text: String) -> XCUIElement { app.staticTexts[text] }

    func expectEventually(
        _ message: String,
        timeout: TimeInterval = 10,
        file: StaticString = #filePath,
        line: UInt = #line,
        _ condition: () -> Bool
    ) {
        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            if condition() { return }
            Thread.sleep(forTimeInterval: 0.25)
        } while Date() < deadline
        XCTFail(message, file: file, line: line)
    }

    /// Task details for the task a notification or toast named. S6 replaces the placeholder sheet with the editor.
    func expectDetailsOpen(file: StaticString = #filePath, line: UInt = #line) {
        expectEventually("Task details never opened", file: file, line: line) {
            app.navigationBars["Task details"].exists || app.textFields["Title"].exists || app.textViews["Title"].exists
        }
    }
}
