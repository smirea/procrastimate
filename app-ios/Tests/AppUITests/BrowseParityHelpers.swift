import XCTest

/// Handles for Browse, the project and label screens, and search, named like the web parity specs' helpers.
extension ParityTestCase {
    var searchField: XCUIElement { app.searchFields.firstMatch }

    func browseProject(_ name: String) -> XCUIElement { app.buttons["browse-project-\(name)"] }
    func browseLabel(_ name: String) -> XCUIElement { app.buttons["browse-label-\(name)"] }

    /// A search result: `project-<name>`, `label-<name>`, or a task's title.
    func result(_ name: String) -> XCUIElement { app.buttons["result-\(name)"] }

    /// Shows the Browse tab at its root, going back from any project or label screen left open on it.
    func openBrowse() {
        tab("Browse").tap()
        for _ in 0..<3 where !app.navigationBars["Browse"].waitForExistence(timeout: 1) {
            back()
        }
        XCTAssertTrue(app.navigationBars["Browse"].exists)
    }

    func back() {
        app.navigationBars.buttons.element(boundBy: 0).tap()
    }

    /// `Add project` in Browse, then return, which opens the new project.
    func createProject(_ name: String) {
        openBrowse()
        app.buttons["Add project"].tap()
        let field = app.textFields["Project name"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        wait(for: field, "hasKeyboardFocus == true")
        field.typeText(name + "\n")
        XCTAssertTrue(app.navigationBars[name].waitForExistence(timeout: 5))
    }

    /// Creates labels from quick add's `@` create row, then dismisses it.
    func createLabels(_ names: String...) {
        openQuickAdd()
        for name in names {
            type("@\(name)")
            app.buttons["Create label “\(name)”"].tap()
        }
        cancelQuickAdd()
    }

    /// Opens the search tab, clears any earlier query, and types `query`.
    func search(_ query: String) {
        tab("Search").tap()
        XCTAssertTrue(searchField.waitForExistence(timeout: 5))
        if !(searchField.value(forKey: "hasKeyboardFocus") as? Bool ?? false) { searchField.tap() }
        let clear = searchField.buttons["Clear text"]
        if clear.exists {
            clear.tap()
        } else if let current = searchField.value as? String, !current.isEmpty, current != searchField.placeholderValue {
            searchField.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: current.count))
        }
        searchField.typeText(query)
    }

    /// `Project actions` or `Label actions`, then `Rename`, replacing the prefilled name.
    func rename(_ noun: String, from old: String, to name: String) {
        app.buttons["\(noun) actions"].tap()
        app.buttons["Rename"].tap()
        let alert = app.alerts["Rename \(noun.lowercased())"]
        XCTAssertTrue(alert.waitForExistence(timeout: 5))
        let field = alert.textFields.firstMatch
        wait(for: field, "hasKeyboardFocus == true")
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: old.count) + name)
        alert.buttons["Rename"].tap()
        waitGone(alert)
    }
}
