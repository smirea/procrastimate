import XCTest

/// The simulator stays light: `XCUIDevice.shared.appearance` reports a change on CI without restyling the device, so
/// following a live switch to dark is left to SwiftUI's `nil` color scheme and the web half.
final class ThemeParityTests: ParityTestCase {
    func test_theme_system() {
        start()
        openSettings()
        XCTAssertTrue(themeOption("System").isSelected)
        expectTheme("light")
        snap("theme-system-light")
    }

    func test_theme_override() {
        start()
        openSettings()
        themeOption("Dark").tap()
        expectTheme("dark")
        themeOption("Light").tap()
        XCTAssertTrue(themeOption("Light").isSelected)
        expectTheme("light")
        themeOption("Dark").tap()
        XCTAssertTrue(themeOption("Dark").isSelected)
        expectTheme("dark")
        snap("theme-override")
        themeOption("System").tap()
        expectTheme("light")
    }

    func test_theme_persist() {
        start()
        openSettings()
        themeOption("Dark").tap()
        expectTheme("dark")
        closeSettings()
        relaunch(now: Self.now)
        expectTheme("dark")
        openSettings()
        XCTAssertTrue(themeOption("Dark").isSelected)
        snap("theme-persist")
        themeOption("System").tap()
        closeSettings()
        relaunch(now: Self.now)
        expectTheme("light")
    }

    /// The saved choice is applied before the first frame, so the launch screen and the Inbox open in it.
    func test_theme_first_paint() {
        start()
        openSettings()
        themeOption("Dark").tap()
        closeSettings()
        Thread.sleep(forTimeInterval: 1)
        launch(reset: false)
        expectTheme("dark")
        XCTAssertTrue(app.navigationBars["Inbox"].waitForExistence(timeout: 10))
        expectTheme("dark")
    }
}
