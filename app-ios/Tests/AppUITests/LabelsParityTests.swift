import XCTest

final class LabelsParityTests: ParityTestCase {
    /// `calls` on `Fix sink` in `Home` and on `Call bank` in Inbox.
    private func seedCalls() {
        createProject("Home")
        openQuickAdd()
        type("@calls")
        app.buttons["Create label “calls”"].tap()
        type("Fix sink\n")
        wait(for: taskInput, "value == ''")
        cancelQuickAdd()
        openTab("Inbox")
        addLabeled("Call bank", "calls")
    }

    func test_labels_view() {
        start()
        seedCalls()
        openBrowse()
        wait(for: browseLabel("calls"), "value == '2'")
        browseLabel("calls").tap()
        XCTAssertTrue(app.navigationBars["calls"].waitForExistence(timeout: 5))
        expectRow("Fix sink", contains: "Home")
        expectRow("Call bank", contains: "Inbox")
        XCTAssertLessThan(row("Fix sink").frame.minY, row("Call bank").frame.minY)
        snap("labels-view")
        openQuickAdd()
        XCTAssertTrue(app.otherElements["Quick add"].staticTexts["calls"].exists)
        type("Call dentist\n")
        wait(for: taskInput, "value == ''")
        cancelQuickAdd()
        expectRow("Call dentist", contains: "calls")
    }

    func test_labels_rename() {
        start()
        createLabels("calls", "Errands")
        addLabeled("Call bank", "calls")
        openBrowse()
        browseLabel("calls").tap()
        XCTAssertTrue(app.navigationBars["calls"].waitForExistence(timeout: 5))
        rename("Label", from: "calls", to: "errands")
        XCTAssertTrue(app.navigationBars["calls"].exists)
        rename("Label", from: "calls", to: "phone")
        XCTAssertTrue(app.navigationBars["phone"].waitForExistence(timeout: 5))
        expectRow("Call bank", contains: "phone")
        snap("labels-rename")
    }

    func test_labels_delete() {
        start()
        createLabels("phone")
        addLabeled("Call bank", "phone")
        openBrowse()
        browseLabel("phone").tap()
        app.buttons["Label actions"].tap()
        app.buttons["Delete label"].tap()
        XCTAssertTrue(app.staticTexts["Delete phone?"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Its tasks stay, without the label."].exists)
        snap("labels-delete")
        app.buttons["Delete"].tap()
        XCTAssertTrue(app.navigationBars["Browse"].waitForExistence(timeout: 5))
        waitGone(browseLabel("phone"))
        openTab("Inbox")
        XCTAssertTrue(row("Call bank").waitForExistence(timeout: 5))
        XCTAssertFalse(row("Call bank").label.contains("phone"))
    }
}
