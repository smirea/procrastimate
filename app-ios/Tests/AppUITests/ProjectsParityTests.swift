import XCTest

final class ProjectsParityTests: ParityTestCase {
    func test_projects_create() {
        start()
        createProject("Home")
        XCTAssertTrue(app.staticTexts["No tasks yet"].exists)
        XCTAssertTrue(app.staticTexts["Add one here, or type #Home in quick add."].exists)
        snap("projects-create")
        back()
        XCTAssertTrue(browseProject("Home").waitForExistence(timeout: 5))
    }

    func test_projects_open() {
        start()
        createProject("Home")
        openQuickAdd()
        XCTAssertTrue(app.buttons["Project Home"].exists)
        type("Fix sink p3\n")
        wait(for: taskInput, "value == ''")
        type("Paint fence fri\n")
        wait(for: taskInput, "value == ''")
        cancelQuickAdd()
        XCTAssertTrue(row("Paint fence").waitForExistence(timeout: 5))
        XCTAssertLessThan(row("Paint fence").frame.minY, row("Fix sink").frame.minY)
        openBrowse()
        wait(for: browseProject("Home"), "value == '2'")
        snap("projects-open")
        tab("Inbox").tap()
        XCTAssertTrue(app.staticTexts["Inbox zero"].waitForExistence(timeout: 5))
        openBrowse()
        browseProject("Home").tap()
        XCTAssertTrue(app.navigationBars["Home"].waitForExistence(timeout: 5))
        XCTAssertTrue(row("Fix sink").exists)
    }

    func test_projects_rename() {
        start()
        createProject("Home")
        rename("Project", from: "Home", to: "House")
        XCTAssertTrue(app.navigationBars["House"].waitForExistence(timeout: 5))
        snap("projects-rename")
        back()
        XCTAssertTrue(browseProject("House").waitForExistence(timeout: 5))
        XCTAssertFalse(browseProject("Home").exists)
    }

    func test_projects_delete() {
        start()
        createProject("House")
        openQuickAdd()
        for title in ["Buy milk", "Fix sink", "Paint fence"] {
            type(title + "\n")
            wait(for: taskInput, "value == ''")
        }
        cancelQuickAdd()
        app.buttons["Project actions"].tap()
        app.buttons["Delete project"].tap()
        XCTAssertTrue(app.staticTexts["Delete House and its 3 tasks?"].waitForExistence(timeout: 5))
        snap("projects-delete")
        app.buttons["Delete"].tap()
        XCTAssertTrue(app.navigationBars["Browse"].waitForExistence(timeout: 5))
        waitGone(browseProject("House"))
        search("milk")
        XCTAssertTrue(app.staticTexts["No results for “milk”"].waitForExistence(timeout: 5))
    }
}
