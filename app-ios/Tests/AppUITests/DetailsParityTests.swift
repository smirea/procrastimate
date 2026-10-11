import XCTest

final class DetailsParityTests: ParityTestCase {
    func test_edit_open() {
        start()
        add("Buy milk")
        openDetails("Buy milk")
        XCTAssertTrue(notes.exists)
        XCTAssertTrue(chip("Set due date").exists)
        XCTAssertTrue(chip("Priority 4").exists)
        snap("edit-open")
    }

    func test_edit_fields() {
        start()
        add("Buy milk")
        openDetails("Buy milk")
        retitle("Buy oat milk")
        wait(for: titleInput, "value == 'Buy oat milk'")
        notes.tap()
        notes.typeText("2 cartons")
        chip("Set due date").tap()
        app.buttons["Tomorrow"].firstMatch.tap()
        XCTAssertTrue(chip("Due Tomorrow").waitForExistence(timeout: 5))
        chip("Priority 4").tap()
        app.buttons["Priority 1"].firstMatch.tap()
        XCTAssertTrue(chip("Priority 1").waitForExistence(timeout: 5))
        snap("edit-fields")
        closeDetails()
        expectRow("Buy oat milk", contains: "2 cartons")

        relaunch(now: Self.now)
        openDetails("Buy oat milk")
        wait(for: notes, "value == '2 cartons'")
        XCTAssertTrue(chip("Due Tomorrow").exists)
        XCTAssertTrue(chip("Priority 1").exists)
    }

    func test_edit_nl() {
        start()
        add("Water plants")
        openDetails("Water plants")
        retitle("Water plants fri 6pm !! remind me 1h before")
        wait(for: titleInput, "value == 'Water plants'")
        XCTAssertTrue(chip("Due Friday 6pm").waitForExistence(timeout: 5))
        XCTAssertTrue(chip("Priority 2").exists)
        XCTAssertTrue(chip("1 reminder").exists)
        snap("edit-nl")
    }

    func test_edit_config_row() {
        start()
        add("Standup")
        openDetails("Standup")
        focusTitleEnd()
        type(" fri 6pm", into: titleInput)
        wait(for: titleInput, "identifier CONTAINS 'due: fri 6pm'")
        XCTAssertTrue(chip("Due Friday 6pm").waitForExistence(timeout: 5))
        snap("edit-config-row")
        titleInput.typeText("\n")
        wait(for: titleInput, "value == 'Standup'")
        closeDetails()
        expectRow("Standup", contains: "Friday 6pm")
    }

    func test_edit_delete() {
        start()
        add("Buy milk", "Pay rent")
        openDetails("Buy milk")
        app.buttons["Delete task"].tap()
        waitGone(titleInput)
        waitGone(row("Buy milk"))
        XCTAssertTrue(app.staticTexts["Deleted “Buy milk”"].firstMatch.exists)
        snap("edit-delete")
        app.buttons["Undo"].firstMatch.tap()
        XCTAssertTrue(row("Buy milk").waitForExistence(timeout: 5))
    }

    func test_reminders_picker() {
        start()
        add("Call mom tomorrow 5pm")
        openDetails("Call mom")
        chip("Add reminder").tap()
        app.buttons["30m before"].firstMatch.tap()
        XCTAssertTrue(chip("1 reminder").waitForExistence(timeout: 5))
        chip("1 reminder").tap()
        app.buttons["Add reminder"].firstMatch.tap()
        XCTAssertTrue(chip("2 reminders").waitForExistence(timeout: 5))
        chip("2 reminders").tap()
        XCTAssertTrue(app.staticTexts["Tomorrow 9am"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["30m before"].exists)
        snap("reminders-picker")
        app.buttons["Remove reminder"].firstMatch.tap()
        XCTAssertTrue(chip("1 reminder").waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Tomorrow 9am"].exists)
    }

    func test_projects_move() {
        start()
        openQuickAdd()
        type("#Home")
        app.buttons["Create project “Home”"].tap()
        wait(for: taskInput, "value == '#Home '")
        wait(for: taskInput, "identifier == 'project: #Home'")
        type(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 6))
        wait(for: taskInput, "value == ''")
        type("Buy milk\n")
        wait(for: taskInput, "value == ''")
        cancelQuickAdd()
        openDetails("Buy milk")
        // In the toolbar, the menu reads as its visible label, the project name.
        let menu = app.descendants(matching: .any)["Project menu"].firstMatch
        XCTAssertEqual(menu.label, "Inbox")
        menu.tap()
        app.buttons["Home"].firstMatch.tap()
        wait(for: menu, "label == 'Home'")
        snap("projects-move")
        closeDetails()
        waitGone(row("Buy milk"))
    }

    func test_labels_picker() {
        start()
        add("Call mom")
        openDetails("Call mom")
        chip("Add labels").tap()
        let find = app.textFields["Find or create a label"]
        XCTAssertTrue(find.waitForExistence(timeout: 5))
        find.tap()
        find.typeText("calls")
        app.buttons["Create label “calls”"].tap()
        find.tap()
        find.typeText("errands")
        app.buttons["Create label “errands”"].tap()
        XCTAssertTrue(chip("Labels calls, errands").waitForExistence(timeout: 5))
        app.buttons["calls"].firstMatch.tap()
        wait(for: app.buttons["calls"].firstMatch, "isSelected == false")
        XCTAssertTrue(app.buttons["errands"].firstMatch.isSelected)
        XCTAssertTrue(chip("Labels errands").waitForExistence(timeout: 5))
        snap("labels-picker")
        dismissPopover()
        closeDetails()
        expectRow("Call mom", contains: "errands")
    }
}
