import XCTest

/// Starts every UI test the way the web suite does: an empty store, frozen at Wednesday, October 14 2026, 10:00 UTC.
@MainActor
class ParityTestCase: XCTestCase {
    private(set) var app: XCUIApplication!

    func launch() {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchEnvironment = [
            "PROCRASTIMATE_NOW": "2026-10-14T10:00:00Z",
            "PROCRASTIMATE_TZ": "UTC",
            "PROCRASTIMATE_RESET": "1",
        ]
        app.launch()
    }

    /// Saves the screen as `<id>.png` in the `ios-parity` artifact, next to the web's screenshot with the same id.
    func snap(_ id: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = id
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
