import XCTest

/// Handles shared by the list and quick add parity tests, named like the web fixture's `App` helpers.
extension ParityTestCase {
    var taskInput: XCUIElement { app.textViews.matching(NSPredicate(format: "label == 'Task name'")).firstMatch }
    var quickAdd: XCUIElement { app.otherElements["Quick add"] }

    /// The row's content, whose accessibility label joins the title and its details.
    func row(_ title: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: "task-\(title)").firstMatch
    }

    func checkbox(_ title: String) -> XCUIElement { app.buttons["Complete \(title)"] }

    func tab(_ name: String) -> XCUIElement { app.tabBars.buttons[name] }

    /// The parsed phrases the input highlights, as `kind: text`, from the readout in the editor's identifier.
    var highlights: String { taskInput.identifier }

    func openQuickAdd() {
        app.buttons["Quick add"].tap()
        XCTAssertTrue(taskInput.waitForExistence(timeout: 5))
        wait(for: taskInput, "hasKeyboardFocus == true")
    }

    /// Adds each task with the keyboard's return key, then dismisses the sheet.
    func add(_ titles: String...) {
        openQuickAdd()
        for title in titles {
            type(title + "\n")
            wait(for: taskInput, "value == ''")
            wait(for: taskInput, "hasKeyboardFocus == true")
        }
        cancelQuickAdd()
    }

    func type(_ text: String) {
        type(text, into: taskInput)
    }

    /// Types a word at a time. The smart input restyles as phrases parse, and keystrokes synthesized during that
    /// update can reach the text view without reaching its binding; each `typeText` waits for the app to idle first.
    func type(_ text: String, into element: XCUIElement) {
        var chunk = ""
        for character in text {
            if character == "\n" {
                if !chunk.isEmpty { element.typeText(chunk) }
                element.typeText("\n")
                chunk = ""
                continue
            }
            chunk.append(character)
            if character == " " {
                element.typeText(chunk)
                chunk = ""
            }
        }
        if !chunk.isEmpty { element.typeText(chunk) }
    }

    func cancelQuickAdd() {
        app.buttons["Cancel"].tap()
        wait(for: taskInput, "exists == false")
    }

    func go(_ name: String) {
        tab(name).tap()
        XCTAssertTrue(app.navigationBars[name].waitForExistence(timeout: 5))
    }

    /// Relaunches at another pinned moment on the same data, after the coalesced write has landed.
    func relaunch(now: String) {
        Thread.sleep(forTimeInterval: 1)
        launch(now: now, reset: false)
        XCTAssertTrue(app.navigationBars["Inbox"].waitForExistence(timeout: 10))
    }

    func wait(for element: XCUIElement, _ predicate: String, timeout: TimeInterval = 5) {
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate(format: predicate), object: element)
        let result = XCTWaiter.wait(for: [expectation], timeout: timeout)
        XCTAssertEqual(result, .completed, "\(predicate) never held for \(element.debugDescription)")
    }

    func waitGone(_ element: XCUIElement) { wait(for: element, "exists == false") }

    func expectRow(_ title: String, contains detail: String, file: StaticString = #filePath, line: UInt = #line) {
        let row = row(title)
        XCTAssertTrue(row.waitForExistence(timeout: 5), "No row \(title)", file: file, line: line)
        XCTAssertTrue(row.label.contains(detail), "\(row.label) lacks \(detail)", file: file, line: line)
    }

    /// The iOS 26 tab bar keeps badges out of the accessibility tree, so tests count the rows a badge is computed from
    /// and leave the badge itself to the screenshot.
    func expectRows(_ count: Int, file: StaticString = #filePath, line: UInt = #line) {
        func rows(in snapshot: any XCUIElementSnapshot) -> [String] {
            (snapshot.identifier.hasPrefix("task-") ? [snapshot.identifier] : []) + snapshot.children.flatMap(rows)
        }
        var titles = Set<String>()
        let deadline = Date().addingTimeInterval(5)
        repeat {
            if let snapshot = try? app.snapshot() { titles = Set(rows(in: snapshot)) }
            if titles.count == count { return }
            Thread.sleep(forTimeInterval: 0.25)
        } while Date() < deadline
        XCTFail("Expected \(count) rows, found \(titles.sorted())", file: file, line: line)
    }

    func expectHighlight(_ kind: String, _ text: String) {
        wait(for: taskInput, "identifier CONTAINS '\(kind): \(text)'")
    }

    /// Launches and waits for the empty Inbox.
    func start() {
        launch()
        XCTAssertTrue(app.navigationBars["Inbox"].waitForExistence(timeout: 10))
    }
}
