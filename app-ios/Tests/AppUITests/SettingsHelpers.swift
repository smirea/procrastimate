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
    /// copies the fixtures, then picks the file whose name starts with `file`. The picker reopens where it was last
    /// and keeps screens it left in its tree, so each pass taps whichever step is hittable. Its glass tab bar never
    /// reports itself hittable, so Browse is tapped by coordinate, and only now and then, since it pops to its root.
    func pick(_ file: String, snapping id: String? = nil) {
        app.buttons["Import from Todoist"].tap()
        let target = pickerItem(BEGINSWITH: file)
        let tabs = app.tabBars["DOC.browsingModeTabBar"]
        var browsed = Date()
        let deadline = Date().addingTimeInterval(60)
        while Date() < deadline {
            if target.exists {
                if let id { snap(id) }
                tapCenter(target)
                return
            }
            if let step = hittableStep() {
                step.tap()
            } else if tabs.exists, Date().timeIntervalSince(browsed) > 8 {
                tapCenter(tabs.buttons["Browse"])
                browsed = Date()
            }
            Thread.sleep(forTimeInterval: 1)
        }
        print(app.debugDescription)
        XCTFail("Never reached \(file) in the document picker")
    }

    /// A cell or text in the picker, never the app itself, whose label is the display name `ProcrastiMate`.
    private func hittableStep() -> XCUIElement? {
        for label in ["ProcrastiMate", "On My iPhone"] {
            for item in pickerItems(equals: label).allElementsBoundByIndex where item.isHittable {
                return item
            }
        }
        return nil
    }

    private func pickerItems(equals label: String) -> XCUIElementQuery {
        app.descendants(matching: .any)
            .matching(NSPredicate(format: "label == %@ AND elementType IN %@", label, [XCUIElement.ElementType.cell.rawValue, XCUIElement.ElementType.staticText.rawValue]))
    }

    private func pickerItem(BEGINSWITH prefix: String) -> XCUIElement {
        app.descendants(matching: .any)
            .matching(NSPredicate(format: "label BEGINSWITH %@ AND elementType IN %@", prefix, [XCUIElement.ElementType.cell.rawValue, XCUIElement.ElementType.staticText.rawValue]))
            .firstMatch
    }

    private func tapCenter(_ element: XCUIElement) {
        element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
    }

    var importSummary: XCUIElement { element("Import summary") }

    /// Browse keeps its stack, so the screen may still be open from an earlier visit.
    func openNotifications() {
        tab("Browse").tap()
        let screen = app.navigationBars["Notifications"]
        if !screen.waitForExistence(timeout: 1) {
            XCTAssertTrue(app.navigationBars["Browse"].waitForExistence(timeout: 5))
            notificationsRow.tap()
        }
        XCTAssertTrue(screen.waitForExistence(timeout: 5))
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
