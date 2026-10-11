import XCTest

/// Drives the App Intents through `PROCRASTIMATE_INTENTS`. The CI simulator has no Siri service, so each line of the
/// script runs that intent's `perform()` inside the app. The readout's label is the machine-readable result.
final class AppIntentsParityTests: ParityTestCase {
    func test_intent_add() {
        runIntents(
            """
            add tomorrow
            add Call mom tomorrow 5pm p1 remind me 30m before
            """,
            until: "added Call mom"
        )
        XCTAssertTrue(intentResults.identifier.contains("empty"))
        expectRow("Call mom", contains: "Tomorrow 5pm")
        expectRow("Call mom", contains: "1 reminders")
        XCTAssertEqual(checkbox("Call mom").value as? String, "Priority 1")
        XCTAssertFalse(row("tomorrow").exists)
        expectSpotlight("Call mom")
    }

    func test_intent_complete_and_spotlight() {
        runIntents(
            """
            add Buy milk
            add Call mom tomorrow
            complete Buy milk
            """,
            until: "completed Buy milk"
        )
        waitGone(row("Buy milk"))
        expectRow("Call mom", contains: "Tomorrow")
        expectSpotlight("Call mom")
    }

    func test_intent_reopen() {
        runIntents(
            """
            add Buy milk
            complete Buy milk
            reopen Buy milk
            """,
            until: "reopened Buy milk"
        )
        XCTAssertTrue(row("Buy milk").waitForExistence(timeout: 5))
        expectSpotlight("Buy milk")
    }

    func test_intent_open_views() {
        runIntents("open today", until: "opened today")
        XCTAssertTrue(app.navigationBars["Today"].waitForExistence(timeout: 5))
        runIntents("open upcoming", until: "opened upcoming")
        XCTAssertTrue(app.navigationBars["Upcoming"].waitForExistence(timeout: 5))
        runIntents("open inbox", until: "opened inbox")
        XCTAssertTrue(app.navigationBars["Inbox"].waitForExistence(timeout: 5))
    }

    func test_intent_project_labels_and_parameters() {
        start()
        createProject("House")
        createLabels("calls")
        Thread.sleep(forTimeInterval: 1)
        runIntents(
            """
            add Ping Ana #House @calls p2 tomorrow
            project House
            """,
            until: "opened-project House",
            reset: false
        )
        XCTAssertTrue(app.navigationBars["House"].waitForExistence(timeout: 5))
        expectRow("Ping Ana", contains: "Tomorrow")
        expectRow("Ping Ana", contains: "calls")
        XCTAssertEqual(checkbox("Ping Ana").value as? String, "Priority 2")

        runIntents(
            "addx\tSubmit report\tHouse\tcalls\tp1\t2026-10-15T17:00:00Z\t2026-10-15T16:30:00Z\nproject House",
            until: "opened-project House",
            reset: false
        )
        expectRow("Submit report", contains: "Tomorrow 5pm")
        expectRow("Submit report", contains: "calls")
        expectRow("Submit report", contains: "1 reminders")
        XCTAssertEqual(checkbox("Submit report").value as? String, "Priority 1")
    }

    func test_intent_search() {
        runIntents(
            """
            add Buy milk
            add Call mom tomorrow
            search milk
            """,
            until: "search milk: Buy milk"
        )
        XCTAssertTrue(result("Buy milk").waitForExistence(timeout: 5))
        XCTAssertFalse(result("Call mom").exists)
    }

    func test_intent_open_task() {
        runIntents(
            """
            add Buy milk
            task Buy milk
            """,
            until: "opened-task Buy milk"
        )
        XCTAssertTrue(app.navigationBars["Task details"].waitForExistence(timeout: 5))
    }

    func test_intent_today_and_overdue() {
        launch(now: Self.yesterday)
        XCTAssertTrue(app.navigationBars["Inbox"].waitForExistence(timeout: 10))
        add("Overdue task today")
        Thread.sleep(forTimeInterval: 1)
        runIntents(
            """
            add Pay rent today
            today
            overdue
            open today
            """,
            until: "opened today",
            reset: false
        )
        XCTAssertTrue(intentResults.identifier.contains("today Pay rent"))
        XCTAssertTrue(intentResults.identifier.contains("overdue Overdue task"))
        XCTAssertTrue(app.navigationBars["Today"].waitForExistence(timeout: 5))
        expectRow("Overdue task", contains: "Yesterday")
        expectRow("Pay rent", contains: "Today")
    }

    private var intentResults: XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'Intent results'")).firstMatch
    }

    private func runIntents(
        _ script: String,
        until marker: String,
        reset: Bool = true,
        now: String = ParityTestCase.now
    ) {
        launch(now: now, reset: reset, environment: ["PROCRASTIMATE_INTENTS": script])
        XCTAssertTrue(intentResults.waitForExistence(timeout: 10))
        wait(for: intentResults, "identifier CONTAINS '\(marker)'")
    }

    private func expectSpotlight(_ titles: String..., file: StaticString = #filePath, line: UInt = #line) {
        let spot = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'Spotlight index'")).firstMatch
        XCTAssertTrue(spot.waitForExistence(timeout: 5), file: file, line: line)
        let expected = titles.isEmpty ? "none" : titles.sorted().joined(separator: ", ")
        wait(for: spot, "identifier == 'Spotlight index: \(expected)'")
    }
}
