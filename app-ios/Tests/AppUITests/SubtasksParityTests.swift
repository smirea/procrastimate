import XCTest

final class SubtasksParityTests: ParityTestCase {
    func test_subtasks_add() {
        start()
        addWithSubtasks("Pack for trip", "Passport", "Charger tomorrow p1")
        XCTAssertTrue(subtaskInput.hasKeyboardFocus)
        XCTAssertTrue(subtask("Passport").exists)
        XCTAssertTrue(subtask("Charger").label.contains("Tomorrow"), subtask("Charger").label)
        XCTAssertEqual(subtaskOrder(["Charger", "Passport"]), ["Passport", "Charger"])
        snap("subtasks-add")
    }

    func test_subtasks_progress() {
        start()
        addWithSubtasks("Pack for trip", "Passport", "Charger", "Socks")
        subtaskCheckbox("Passport").tap()
        closeDetails()
        expectRow("Pack for trip", contains: "1 of 3 subtasks done")
        XCTAssertFalse(row("Passport").exists)
        snap("subtasks-progress")
    }

    func test_subtasks_check() {
        start()
        addWithSubtasks("Pack for trip", "Passport", "Charger")
        subtaskCheckbox("Passport").tap()
        wait(for: subtaskCheckbox("Passport"), "isSelected == true")
        XCTAssertFalse(app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH 'Completed'")).firstMatch.exists)
        snap("subtasks-check")
        subtaskCheckbox("Passport").tap()
        wait(for: subtaskCheckbox("Passport"), "isSelected == false")
    }

    func test_subtasks_reorder() {
        start()
        addWithSubtasks("Pack for trip", "Passport", "Charger", "Socks")
        let handle = app.descendants(matching: .any)["Reorder Socks"].firstMatch
        let target = subtask("Passport").coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2))
        handle.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
            .press(forDuration: 0.3, thenDragTo: target, withVelocity: .slow, thenHoldForDuration: 0.3)
        let expected = ["Socks", "Passport", "Charger"]
        let deadline = Date().addingTimeInterval(5)
        while subtaskOrder(expected) != expected, Date() < deadline { Thread.sleep(forTimeInterval: 0.25) }
        XCTAssertEqual(subtaskOrder(expected), expected)
        snap("subtasks-reorder")
    }

    func test_subtasks_nest() {
        start()
        addWithSubtasks("Pack for trip", "Charger")
        subtask("Charger").tap()
        wait(for: titleInput, "value == 'Charger'")
        XCTAssertTrue(app.buttons["Back to Pack for trip"].waitForExistence(timeout: 5))
        addSubtasks("Cable")
        snap("subtasks-nest")
        app.buttons["Back to Pack for trip"].tap()
        wait(for: titleInput, "value == 'Pack for trip'")
        wait(for: subtask("Charger"), "label CONTAINS '0 of 1 subtasks done'")
    }

    func test_subtasks_complete_parent() {
        start()
        addWithSubtasks("Pack for trip", "Passport", "Charger")
        subtaskCheckbox("Passport").tap()
        closeDetails()
        checkbox("Pack for trip").tap()
        waitGone(row("Pack for trip"))
        app.buttons["Undo"].firstMatch.tap()
        expectRow("Pack for trip", contains: "1 of 2 subtasks done")
        openDetails("Pack for trip")
        XCTAssertTrue(subtaskCheckbox("Passport").isSelected)
        XCTAssertFalse(subtaskCheckbox("Charger").isSelected)
        snap("subtasks-complete-parent")
    }

    func test_subtasks_recurring() {
        start()
        add("Weekly review every fri")
        openDetails("Weekly review")
        addSubtasks("Inbox zero", "Plan week")
        subtaskCheckbox("Inbox zero").tap()
        subtaskCheckbox("Plan week").tap()
        closeDetails()
        expectRow("Weekly review", contains: "2 of 2 subtasks done")
        checkbox("Weekly review").tap()
        wait(for: row("Weekly review"), "label CONTAINS 'Oct 23'")
        expectRow("Weekly review", contains: "0 of 2 subtasks done")
        snap("subtasks-recurring")
    }

    func test_subtasks_dated() {
        start()
        addWithSubtasks("Pack for trip", "Buy adapter today")
        closeDetails()
        XCTAssertFalse(row("Buy adapter").exists)
        go("Today")
        expectRow("Buy adapter", contains: "Subtask of Pack for trip")
        snap("subtasks-dated")
    }
}
