import XCTest

final class PriorityParityTests: ParityTestCase {
    func test_priority_nl() {
        start()
        openQuickAdd()
        type("Pay rent p1")
        expectHighlight("priority", "p1")
        XCTAssertTrue(app.buttons["Priority 1"].exists)
        snap("priority-nl")
        type("\n")
        type("Fix sink !!\n")
        type("Call bank urgent\n")
        cancelQuickAdd()
        XCTAssertEqual(checkbox("Pay rent").value as? String, "Priority 1")
        XCTAssertEqual(checkbox("Fix sink").value as? String, "Priority 2")
        XCTAssertEqual(checkbox("Call bank").value as? String, "Priority 1")
    }

    func test_priority_picker() {
        start()
        openQuickAdd()
        type("Pay rent")
        app.buttons["Priority 4"].tap()
        app.buttons["Priority 2"].tap()
        XCTAssertTrue(app.buttons["Priority 2"].waitForExistence(timeout: 5))
        snap("priority-picker")
        app.buttons["Add task"].tap()
        cancelQuickAdd()
        XCTAssertEqual(checkbox("Pay rent").value as? String, "Priority 2")

        openDetails("Pay rent")
        chip("Priority 2").tap()
        app.buttons["Priority 3"].firstMatch.tap()
        XCTAssertTrue(chip("Priority 3").waitForExistence(timeout: 5))
        closeDetails()
        XCTAssertEqual(checkbox("Pay rent").value as? String, "Priority 3")
    }

    func test_priority_replace() {
        start()
        openQuickAdd()
        type("Pay rent p1")
        expectHighlight("priority", "p1")
        app.buttons["Priority 1"].tap()
        app.buttons["Priority 3"].tap()
        wait(for: taskInput, "value == 'Pay rent '")
        XCTAssertTrue(app.buttons["Priority 3"].exists)
        snap("priority-replace")
        app.buttons["Add task"].tap()
        cancelQuickAdd()
        XCTAssertEqual(checkbox("Pay rent").value as? String, "Priority 3")
    }

    func test_priority_display() {
        start()
        add("Urgent p1", "High p2", "Medium p3", "Plain")
        XCTAssertEqual(checkbox("Urgent").value as? String, "Priority 1")
        XCTAssertEqual(checkbox("High").value as? String, "Priority 2")
        XCTAssertEqual(checkbox("Medium").value as? String, "Priority 3")
        XCTAssertEqual(checkbox("Plain").value as? String, "Priority 4")
        snap("priority-display")
    }
}
