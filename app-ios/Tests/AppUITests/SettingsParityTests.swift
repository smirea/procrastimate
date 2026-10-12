import XCTest

final class SettingsParityTests: ParityTestCase {
    func test_settings_sheet() {
        start()
        openSettings()
        XCTAssertTrue(themeOption("System").exists)
        XCTAssertTrue(app.buttons["Import from Todoist"].exists)
        XCTAssertTrue(app.staticTexts["Notifications: Off"].exists || app.staticTexts["Notifications: On"].exists || app.buttons["Notifications need permission"].exists)
        XCTAssertTrue(app.buttons["Delete all data"].exists)
        XCTAssertFalse(app.buttons["Set up sync"].exists)
        snap("settings-sheet")
        closeSettings()
        XCTAssertTrue(app.navigationBars["Browse"].exists)
    }

    func test_settings_dictation() {
        start()
        openSettings()
        let dictation = app.segmentedControls["Dictation"]
        XCTAssertTrue(dictation.waitForExistence(timeout: 5))
        XCTAssertTrue(dictation.buttons["Native"].isSelected)
        dictation.buttons["ElevenLabs"].tap()
        XCTAssertTrue(dictation.buttons["ElevenLabs"].isSelected)
        snap("settings-dictation")
        closeSettings()
        openSettings()
        XCTAssertTrue(app.segmentedControls["Dictation"].buttons["ElevenLabs"].isSelected)
        app.segmentedControls["Dictation"].buttons["Native"].tap()
        XCTAssertTrue(app.segmentedControls["Dictation"].buttons["Native"].isSelected)
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
