import XCTest

final class ThemeParityTests: ParityTestCase {
    /// The appearance is the simulator's, so every test leaves it light for the next.
    override func tearDown() {
        XCUIDevice.shared.appearance = .light
        super.tearDown()
    }

    func test_theme_system() {
        XCUIDevice.shared.appearance = .light
        start()
        openSettings()
        XCTAssertTrue(themeOption("System").isSelected)
        expectTheme("light")
        snap("theme-system-light")
        XCUIDevice.shared.appearance = .dark
        expectTheme("dark")
        snap("theme-system-dark")
        XCUIDevice.shared.appearance = .light
        expectTheme("light")
    }

    func test_theme_override() {
        XCUIDevice.shared.appearance = .dark
        start()
        openSettings()
        themeOption("Light").tap()
        expectTheme("light")
        XCUIDevice.shared.appearance = .light
        themeOption("Dark").tap()
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
