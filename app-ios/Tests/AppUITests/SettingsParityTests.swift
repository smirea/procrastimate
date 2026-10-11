import XCTest

final class SettingsParityTests: ParityTestCase {
    func test_settings_sheet() {
        start()
        openSettings()
        XCTAssertTrue(themeOption("System").exists)
        XCTAssertTrue(app.buttons["Import from Todoist"].exists)
        XCTAssertTrue(app.buttons["Set up sync"].exists)
        XCTAssertFalse(app.buttons["Set up sync"].isEnabled)
        snap("settings-sheet")
        closeSettings()
        XCTAssertTrue(app.navigationBars["Browse"].exists)
    }

    func test_settings_theme() {
        start()
        openSettings()
        XCTAssertTrue(themeOption("System").isSelected)
        expectTheme("light")
        themeOption("Dark").tap()
        XCTAssertTrue(themeOption("Dark").isSelected)
        expectTheme("dark")
        snap("settings-theme")
    }
}
