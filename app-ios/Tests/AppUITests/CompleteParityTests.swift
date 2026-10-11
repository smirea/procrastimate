import XCTest

final class CompleteParityTests: ParityTestCase {
    func test_complete_check() {
        start()
        add("Pay rent", "Buy milk")
        checkbox("Pay rent").tap()
        waitGone(row("Pay rent"))
        XCTAssertTrue(app.staticTexts["Completed “Pay rent”"].exists)
        XCTAssertTrue(row("Buy milk").exists)
        snap("complete-check")
    }

    func test_complete_undo() {
        start()
        add("Pay rent")
        checkbox("Pay rent").tap()
        waitGone(row("Pay rent"))
        app.buttons["Undo"].tap()
        XCTAssertTrue(row("Pay rent").waitForExistence(timeout: 5))
        snap("complete-undo")
    }

    func test_complete_swipe() {
        start()
        add("Pay rent")
        row("Pay rent").swipeRight()
        let complete = app.buttons["Complete"]
        if complete.waitForExistence(timeout: 1) { complete.tap() }
        waitGone(row("Pay rent"))
        XCTAssertTrue(app.staticTexts["Completed “Pay rent”"].exists)
        snap("complete-swipe")
    }

    func test_complete_recurring() {
        start()
        add("Standup every fri 9am")
        expectRow("Standup", contains: "Friday 9am")
        checkbox("Standup").tap()
        XCTAssertTrue(app.staticTexts["Completed “Standup”, next due Oct 23 9am"].waitForExistence(timeout: 5))
        expectRow("Standup", contains: "Oct 23 9am")
        snap("complete-recurring")
    }

    func test_edit_swipe_delete() {
        start()
        add("Pay rent")
        row("Pay rent").swipeLeft()
        let delete = app.buttons["Delete"]
        if delete.waitForExistence(timeout: 1) { delete.tap() }
        waitGone(row("Pay rent"))
        XCTAssertTrue(app.staticTexts["Deleted “Pay rent”"].exists)
        snap("edit-swipe-delete")
        app.buttons["Undo"].tap()
        XCTAssertTrue(row("Pay rent").waitForExistence(timeout: 5))
    }
}
