import XCTest

final class QuickAddParityTests: ParityTestCase {
    func test_add_open() {
        start()
        openQuickAdd()
        XCTAssertTrue(app.buttons["Set due date"].exists)
        XCTAssertTrue(app.buttons["Add task"].exists)
        XCTAssertFalse(app.buttons["Add task"].isEnabled)
        snap("add-open")
    }

    func test_add_save() {
        start()
        add("Buy milk")
        XCTAssertTrue(row("Buy milk").waitForExistence(timeout: 5))
        snap("add-save")
    }

    func test_add_due() {
        start()
        add("Call mom tomorrow")
        expectRow("Call mom", contains: "Tomorrow")
        XCTAssertFalse(row("Call mom tomorrow").exists)
        snap("add-due")
    }

    func test_add_shorthand() {
        start()
        openQuickAdd()
        type("Call Tom about the sun hat tom 5p r30m")
        expectHighlight("due", "tom 5p")
        expectHighlight("reminder", "r30m")
        XCTAssertFalse(highlights.contains("Tom about"))
        XCTAssertTrue(app.buttons["Due Tomorrow 5pm"].exists)
        XCTAssertTrue(app.staticTexts["30m before"].exists)
        snap("add-shorthand")
        type("\n")
        cancelQuickAdd()
        expectRow("Call Tom about the sun hat", contains: "Tomorrow 5pm")
    }

    func test_add_recurrence() {
        start()
        openQuickAdd()
        type("Standup every mon 9:30a")
        expectHighlight("recurrence", "every mon")
        expectHighlight("due", "9:30a")
        XCTAssertTrue(app.staticTexts["Every Mon"].exists)
        XCTAssertTrue(app.buttons["Due Monday 9:30am"].exists)
        snap("add-recurrence")
        type("\n")
        cancelQuickAdd()
        expectRow("Standup", contains: "Monday 9:30am")
        expectRow("Standup", contains: "Repeats every Mon")
    }

    func test_add_highlight() {
        start()
        openQuickAdd()
        type("call mom tomorrow 5pm remind me 30m before p1")
        expectHighlight("due", "tomorrow 5pm")
        expectHighlight("reminder", "remind me 30m before")
        expectHighlight("priority", "p1")
        expectRendered("tomorrow 5pm; remind me 30m before; p1")
        snap("add-highlight")
    }

    func test_add_config_row() {
        start()
        openQuickAdd()
        type("Gym every mon 7am r15m p2")
        XCTAssertTrue(app.buttons["Due Monday 7am"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Every Mon"].exists)
        XCTAssertTrue(app.staticTexts["15m before"].exists)
        XCTAssertTrue(app.buttons["Priority 2"].exists)
        snap("add-config-row")
    }

    func test_add_keep_text() {
        start()
        openQuickAdd()
        type("Read Monday Night Club")
        expectHighlight("due", "Monday")
        app.buttons["Keep as text"].firstMatch.tap()
        wait(for: taskInput, "identifier == ''")
        XCTAssertTrue(app.buttons["Set due date"].exists)
        snap("add-keep-text")
        type("\n")
        cancelQuickAdd()
        let saved = row("Read Monday Night Club")
        XCTAssertTrue(saved.waitForExistence(timeout: 5))
        XCTAssertFalse(saved.label.contains("Monday,"))
    }

    func test_add_defaults() {
        start()
        go("Today")
        openQuickAdd()
        XCTAssertTrue(app.buttons["Due Today"].exists)
        snap("add-defaults")
        type("Stretch\n")
        cancelQuickAdd()
        XCTAssertTrue(row("Stretch").waitForExistence(timeout: 5))
    }

    func test_add_cancel() {
        start()
        openQuickAdd()
        type("Discard me")
        cancelQuickAdd()
        XCTAssertFalse(row("Discard me").exists)
        XCTAssertTrue(app.staticTexts["Inbox zero"].exists)
        snap("add-cancel")
        openQuickAdd()
        XCTAssertEqual(taskInput.value as? String, "")
    }

    func test_add_repeat() {
        start()
        openQuickAdd()
        type("Buy milk\n")
        wait(for: taskInput, "value == ''")
        type("Pay rent\n")
        wait(for: taskInput, "value == ''")
        XCTAssertTrue(taskInput.exists)
        XCTAssertTrue(row("Buy milk").exists)
        XCTAssertTrue(row("Pay rent").exists)
        snap("add-repeat")
    }

    func test_reminders_nl() {
        start()
        openQuickAdd()
        type("Call mom tomorrow 5pm remind me 30m before")
        expectHighlight("reminder", "remind me 30m before")
        XCTAssertTrue(app.staticTexts["30m before"].exists)
        snap("reminders-nl")
        type("\n")
        cancelQuickAdd()
        expectRow("Call mom", contains: "1 reminders")
    }

    func test_projects_assign() {
        start()
        openQuickAdd()
        type("#Errands")
        app.buttons["Create project “Errands”"].tap()
        type("Pay rent today")
        expectHighlight("project", "#Errands")
        XCTAssertTrue(app.buttons["Project Errands"].exists)
        snap("projects-assign")
        type("\n")
        cancelQuickAdd()
        XCTAssertFalse(row("Pay rent").exists)
        go("Today")
        expectRow("Pay rent", contains: "Errands")
    }

    func test_projects_autocomplete() {
        start()
        openQuickAdd()
        type("#Errands")
        app.buttons["Create project “Errands”"].tap()
        type("Buy milk\n")
        type("#Home")
        app.buttons["Create project “Home”"].tap()
        type("Fix sink\n")
        type("#e")
        let list = app.otherElements["Projects"]
        XCTAssertTrue(list.waitForExistence(timeout: 5))
        let errands = list.buttons["Errands"], home = list.buttons["Home"], create = list.buttons["Create project “e”"]
        XCTAssertTrue(errands.exists && home.exists && create.exists)
        XCTAssertLessThan(errands.frame.minY, home.frame.minY)
        XCTAssertLessThan(home.frame.minY, create.frame.minY)
        snap("projects-autocomplete")
        home.tap()
        XCTAssertEqual(taskInput.value as? String, "#Home ")
    }

    func test_labels_type() {
        start()
        openQuickAdd()
        type("@calls")
        app.buttons["Create label “calls”"].tap()
        type("Ping ana@example.com")
        expectHighlight("label", "@calls")
        XCTAssertFalse(highlights.contains("example"))
        snap("labels-type")
        type("\n")
        cancelQuickAdd()
        expectRow("Ping ana@example.com", contains: "calls")
    }

    func test_labels_autocomplete() {
        start()
        openQuickAdd()
        type("@ca")
        let list = app.otherElements["Labels"]
        XCTAssertTrue(list.waitForExistence(timeout: 5))
        XCTAssertTrue(list.buttons["Create label “ca”"].exists)
        type("lls")
        list.buttons["Create label “calls”"].tap()
        XCTAssertEqual(taskInput.value as? String, "@calls ")
        type("Ping Ana")
        type("\n")
        type("@c")
        XCTAssertTrue(list.buttons["calls"].waitForExistence(timeout: 5))
        snap("labels-autocomplete")
    }

    func test_labels_keep_text() {
        start()
        openQuickAdd()
        type("@calls")
        app.buttons["Create label “calls”"].tap()
        type("Ping Ana\n")
        type("Ping @calls")
        expectHighlight("label", "@calls")
        app.buttons["Keep as text"].firstMatch.tap()
        wait(for: taskInput, "identifier == ''")
        snap("labels-keep-text")
        type("\n")
        cancelQuickAdd()
        XCTAssertTrue(row("Ping @calls").waitForExistence(timeout: 5))
    }

    func test_add_create() {
        start()
        openQuickAdd()
        type("Call @dentist now")
        XCTAssertTrue(app.buttons["Create @dentist"].waitForExistence(timeout: 5))
        type("\n")
        wait(for: taskInput, "value == ''")
        type("Buy milk #Personal @phone today")
        let project = app.buttons["Create #Personal"], label = app.buttons["Create @phone"]
        XCTAssertTrue(project.waitForExistence(timeout: 5))
        XCTAssertTrue(label.exists)
        project.tap()
        expectHighlight("project", "#Personal")
        waitGone(project)
        label.tap()
        expectHighlight("label", "@phone")
        waitGone(label)
        snap("add-create")
        type("\n")
        wait(for: taskInput, "value == ''")
        cancelQuickAdd()
        XCTAssertTrue(row("Call @dentist now").waitForExistence(timeout: 5))
        go("Today")
        expectRow("Buy milk", contains: "Personal")
        expectRow("Buy milk", contains: "phone")
    }

    func test_add_dock() {
        start()
        openQuickAdd()
        waitGone(app.buttons["Quick add"])
        let keyboard = app.keyboards.firstMatch
        XCTAssertTrue(keyboard.waitForExistence(timeout: 5))
        // The keyboard's frame starts below its suggestion bar, so the card meets the keyboard's visible top edge
        // when it ends at most one bar height above that frame.
        var gap = CGFloat.infinity
        let deadline = Date().addingTimeInterval(3)
        repeat {
            gap = keyboard.frame.minY - quickAdd.frame.maxY
            if (0...56).contains(gap) { break }
            Thread.sleep(forTimeInterval: 0.2)
        } while Date() < deadline
        XCTAssertTrue((0...56).contains(gap), "Quick add ends \(gap) pt above the keyboard")
        XCTAssertEqual(quickAdd.frame.minX, app.frame.minX, accuracy: 1, "Quick add is inset from the screen edge")
        XCTAssertEqual(quickAdd.frame.width, app.frame.width, accuracy: 1, "Quick add does not span the screen")
        snap("add-dock")
        cancelQuickAdd()
        XCTAssertTrue(app.buttons["Quick add"].waitForExistence(timeout: 5))
    }
}
