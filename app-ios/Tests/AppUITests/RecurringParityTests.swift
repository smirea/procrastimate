import XCTest

final class RecurringParityTests: ParityTestCase {
    func test_recurring_display() {
        start()
        add("Standup every mon 9am", "Water plants every 3 days")
        expectRow("Standup", contains: "Repeats every Mon")
        expectRow("Water plants", contains: "Repeats every 3 days")
        snap("recurring-display")
    }

    func test_recurring_picker() {
        start()
        add("Standup fri 9am")
        openDetails("Standup")
        chip("Set repeat").tap()
        let presets = ["Every day", "Every weekday", "Every Fri", "Every month", "Every year"]
        for preset in presets { XCTAssertTrue(app.buttons[preset].waitForExistence(timeout: 5), preset) }
        XCTAssertEqual(presets.sorted { app.buttons[$0].frame.minY < app.buttons[$1].frame.minY }, presets)
        app.buttons["Every Fri"].tap()
        waitGone(app.buttons["Every weekday"])
        XCTAssertTrue(chip("Repeats every Fri").waitForExistence(timeout: 5))

        chip("Repeats every Fri").tap()
        XCTAssertTrue(app.buttons["Fri"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Fri"].isSelected)
        app.buttons["Mon"].tap()
        app.buttons["Wed"].tap()
        wait(for: app.buttons["Wed"], "isSelected == true")
        XCTAssertTrue(chip("Repeats every Mon, Wed, Fri").waitForExistence(timeout: 5))
        snap("recurring-picker")

        let interval = app.textFields["Repeat interval"]
        interval.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.5)).tap()
        interval.typeText(XCUIKeyboardKey.delete.rawValue + "3")
        app.buttons["Set"].tap()
        XCTAssertTrue(chip("Repeats every 3 days").waitForExistence(timeout: 5))

        chip("Repeats every 3 days").tap()
        app.buttons["Don’t repeat"].tap()
        XCTAssertTrue(chip("Set repeat").waitForExistence(timeout: 5))
        closeDetails()
        expectRow("Standup", contains: "Friday 9am")
    }
}
