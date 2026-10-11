import XCTest

/// Starts every UI test the way the web suite does: an empty store, frozen at Wednesday, October 14 2026, 10:00 UTC.
@MainActor
class ParityTestCase: XCTestCase {
    static let now = "2026-10-14T10:00:00Z"
    static let yesterday = "2026-10-13T10:00:00Z"

    private(set) var app: XCUIApplication!

    /// `reset: false` relaunches on the stored data, like a reload after the web's `setNow`.
    func launch(now: String = ParityTestCase.now, reset: Bool = true) {
        continueAfterFailure = false
        app?.terminate()
        app = XCUIApplication()
        app.launchEnvironment = [
            "PROCRASTIMATE_NOW": now,
            "PROCRASTIMATE_TZ": "UTC",
            "PROCRASTIMATE_RESET": reset ? "1" : "0",
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
