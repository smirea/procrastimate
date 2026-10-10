import XCTest

final class ShellParityTests: ParityTestCase {
    func test_shell_launch() {
        launch()
        XCTAssertTrue(app.navigationBars["Inbox"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Inbox zero"].exists)
        XCTAssertTrue(app.tabBars.buttons["Inbox"].isSelected)
        snap("shell-launch")
    }

    /// Not a parity row: walks the tabs so the shell, the pinned clock, and the settings sheet show in the artifact.
    func test_shell_tabs() {
        launch()
        XCTAssertTrue(app.navigationBars["Inbox"].waitForExistence(timeout: 10))

        app.tabBars.buttons["Today"].tap()
        XCTAssertTrue(app.navigationBars["Today"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Wednesday, October 14"].exists)
        XCTAssertTrue(app.staticTexts["All clear for today"].exists)
        snap("shell-today")

        app.tabBars.buttons["Browse"].tap()
        XCTAssertTrue(app.navigationBars["Browse"].waitForExistence(timeout: 5))
        snap("shell-browse")

        app.buttons["Settings"].tap()
        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 5))
        snap("shell-settings")
    }
}
