import XCTest

final class SearchParityTests: ParityTestCase {
    /// The search feature map's seed, minus the notes, which only task details can set. `Fix sink` is added inside
    /// `Home`, since Return after a trailing `#Home` picks the suggestion instead of saving.
    private func seedHome() {
        createProject("Home")
        add("Fix sink p2")
        openTab("Inbox")
        add("Water plants tomorrow", "Call plumber", "Buy milk", "Update résumé")
    }

    private func seedLabels() {
        createLabels("calls", "waiting")
        addLabeled("Plumber", "calls")
        addLabeled("Dentist", "waiting", "calls")
        add("Read a book")
    }

    func test_search_open() {
        start()
        openTab("Search")
        XCTAssertTrue(searchField.waitForExistence(timeout: 5))
        wait(for: searchField, "hasKeyboardFocus == true")
        snap("search-open")
    }

    func test_search_match() {
        start()
        seedHome()
        search("home")
        XCTAssertTrue(result("project-Home").waitForExistence(timeout: 5))
        XCTAssertTrue(result("Fix sink").exists)
        XCTAssertFalse(result("Call plumber").exists)
        XCTAssertLessThan(result("project-Home").frame.minY, result("Fix sink").frame.minY)
        snap("search-match")
        search("sink home")
        wait(for: result("project-Home"), "exists == false")
        XCTAssertTrue(result("Fix sink").exists)
        search("resume")
        XCTAssertTrue(result("Update résumé").waitForExistence(timeout: 5))
    }

    func test_search_highlight() {
        start()
        seedLabels()
        search("call")
        XCTAssertTrue(result("label-calls").waitForExistence(timeout: 5))
        wait(for: result("label-calls"), "value == 'Matches call'")
        wait(for: result("Plumber"), "value == 'Matches call'")
        wait(for: result("Dentist"), "value == 'Matches call'")
        XCTAssertFalse(result("Read a book").exists)
        snap("search-highlight")
        search("dentist waiting")
        wait(for: result("Plumber"), "exists == false")
        XCTAssertTrue(result("Dentist").exists)
    }

    /// Return opens the selected result, the first one. Up and Down need a hardware keyboard, which simulator
    /// XCUITests cannot synthesize for `onKeyPress`.
    func test_search_keyboard() {
        start()
        seedHome()
        search("hom")
        XCTAssertTrue(result("project-Home").waitForExistence(timeout: 5))
        snap("search-keyboard")
        searchField.typeText("\n")
        XCTAssertTrue(app.navigationBars["Home"].waitForExistence(timeout: 5))
        XCTAssertTrue(row("Fix sink").exists)
    }

    func test_search_open_result() {
        start()
        seedHome()
        search("home")
        result("project-Home").tap()
        XCTAssertTrue(app.navigationBars["Home"].waitForExistence(timeout: 5))
        XCTAssertTrue(row("Fix sink").exists)
        back()
        result("Fix sink").tap()
        XCTAssertTrue(app.navigationBars["Task details"].waitForExistence(timeout: 5))
        snap("search-open-result")
    }

    func test_search_completed() {
        start()
        add("Renew passport", "Passport photos")
        checkbox("Renew passport").tap()
        waitGone(row("Renew passport"))
        search("passport")
        XCTAssertTrue(result("Renew passport").waitForExistence(timeout: 5))
        XCTAssertTrue(result("Renew passport").label.contains("Completed Today"))
        XCTAssertLessThan(result("Passport photos").frame.minY, result("Renew passport").frame.minY)
        snap("search-completed")
        result("Renew passport").tap()
        wait(for: titleInput, "value == 'Renew passport'")
        app.buttons["Reopen"].firstMatch.tap()
        XCTAssertTrue(app.buttons["Complete"].firstMatch.waitForExistence(timeout: 5))
        closeDetails()
        wait(for: result("Renew passport"), "NOT (label CONTAINS 'Completed')")
        openTab("Inbox")
        XCTAssertTrue(row("Renew passport").waitForExistence(timeout: 5))
        XCTAssertTrue(row("Passport photos").exists)
    }

    func test_subtasks_search() {
        start()
        addWithSubtasks("Pack for trip", "Passport")
        closeDetails()
        search("passport")
        XCTAssertTrue(result("Passport").waitForExistence(timeout: 5))
        XCTAssertTrue(result("Passport").label.contains("Subtask of Pack for trip"), result("Passport").label)
        snap("subtasks-search")
        result("Passport").tap()
        wait(for: titleInput, "value == 'Passport'")
        app.buttons["Back to Pack for trip"].tap()
        wait(for: titleInput, "value == 'Pack for trip'")
    }

    func test_search_empty() {
        start()
        add("Fix sink")
        search("sink garden")
        XCTAssertTrue(app.staticTexts["No results for “sink garden”"].waitForExistence(timeout: 5))
        snap("search-empty")
    }

    func test_labels_search() {
        start()
        seedLabels()
        search("wait")
        result("label-waiting").tap()
        XCTAssertTrue(app.navigationBars["waiting"].waitForExistence(timeout: 5))
        XCTAssertTrue(row("Dentist").exists)
        XCTAssertFalse(row("Plumber").exists)
        snap("labels-search")
    }
}
