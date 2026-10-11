import XCTest

final class ViewsParityTests: ParityTestCase {
    func test_views_inbox() {
        start()
        add("Buy milk", "Pay rent tomorrow", "Standup today 9am")
        for title in ["Buy milk", "Pay rent", "Standup"] {
            XCTAssertTrue(row(title).exists, title)
        }
        snap("views-inbox")
    }

    func test_views_today() {
        launch(now: Self.yesterday)
        XCTAssertTrue(app.navigationBars["Inbox"].waitForExistence(timeout: 10))
        add("Overdue task today")
        relaunch(now: Self.now)
        add("Today task today 9am", "Later task in 3 days")
        go("Today")
        XCTAssertTrue(app.staticTexts["Wednesday, October 14"].exists)
        XCTAssertTrue(app.staticTexts["Overdue"].exists)
        expectRow("Overdue task", contains: "Yesterday")
        expectRow("Today task", contains: "9am")
        XCTAssertFalse(row("Later task").exists)
        XCTAssertLessThan(row("Overdue task").frame.minY, row("Today task").frame.minY)
        snap("views-today")
    }

    func test_views_upcoming() {
        start()
        add("Gym tomorrow", "Dentist fri 3pm", "Later task in 3 days", "Pay rent today", "Someday task")
        go("Upcoming")
        XCTAssertTrue(app.staticTexts["Oct 15 · Tomorrow · Thursday"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Oct 16 · Friday"].exists)
        XCTAssertTrue(app.staticTexts["Oct 17 · Saturday"].exists)
        expectRow("Dentist", contains: "3pm")
        XCTAssertFalse(row("Pay rent").exists)
        XCTAssertFalse(row("Someday task").exists)
        XCTAssertLessThan(row("Gym").frame.minY, row("Dentist").frame.minY)
        XCTAssertLessThan(row("Dentist").frame.minY, row("Later task").frame.minY)
        snap("views-upcoming")
    }

    func test_views_empty() {
        start()
        XCTAssertTrue(app.staticTexts["Inbox zero"].exists)
        go("Today")
        XCTAssertTrue(app.staticTexts["All clear for today"].exists)
        go("Upcoming")
        XCTAssertTrue(app.staticTexts["Nothing scheduled"].exists)
        snap("views-empty")
    }

    func test_views_counts() {
        start()
        add("Buy milk", "Pay rent today", "Standup today 9am", "Gym tomorrow")
        expectBadge(4, on: "Inbox")
        expectBadge(2, on: "Today")
        snap("views-counts")
        checkbox("Pay rent").tap()
        expectBadge(3, on: "Inbox")
        expectBadge(1, on: "Today")
    }

    func test_labels_chips() {
        start()
        openQuickAdd()
        type("@calls")
        app.buttons["Create label “calls”"].tap()
        type("@errands")
        app.buttons["Create label “errands”"].tap()
        type("Ping Ana\n")
        cancelQuickAdd()
        expectRow("Ping Ana", contains: "calls")
        expectRow("Ping Ana", contains: "errands")
        snap("labels-chips")
    }
}
