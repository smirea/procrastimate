import XCTest

/// While the app is open, each due time and reminder shows as a `Reminder: <title>` toast. Relaunching at a later
/// pinned moment shows the ones that came up since the last check, like the web's reload after `setNow`.
final class RemindersParityTests: ParityTestCase {
    func test_reminders_fire() {
        start()
        add("Call mom today 10:30am")
        relaunch(now: "2026-10-14T10:31:00Z")
        XCTAssertTrue(toast("Reminder: Call mom").waitForExistence(timeout: 5))
        snap("reminders-fire")
        app.buttons["Open"].tap()
        expectDetailsOpen()
    }

    func test_reminders_due_time() {
        start()
        add(
            "Call mom today 10:30am",
            "Taxes today",
            "Standup today 10:45am remind me at 10:45am",
            "Gym today 11am remind me 30m before"
        )

        relaunch(now: "2026-10-14T10:31:00Z")
        XCTAssertTrue(toast("Reminder: Call mom").waitForExistence(timeout: 5))
        XCTAssertTrue(toast("Reminder: Gym").exists)
        XCTAssertFalse(toast("Reminder: Standup").exists)
        XCTAssertFalse(toast("Reminder: Taxes").exists)
        snap("reminders-due-time")

        relaunch(now: "2026-10-14T10:46:00Z")
        XCTAssertTrue(toast("Reminder: Standup").waitForExistence(timeout: 5))
        XCTAssertEqual(app.staticTexts.matching(NSPredicate(format: "label == 'Reminder: Standup'")).count, 1)
        XCTAssertFalse(toast("Reminder: Call mom").exists)

        relaunch(now: "2026-10-14T11:01:00Z")
        XCTAssertTrue(toast("Reminder: Gym").waitForExistence(timeout: 5))
        XCTAssertFalse(toast("Reminder: Standup").exists)
        XCTAssertFalse(toast("Reminder: Taxes").exists)
    }

    func test_recurring_reminders() {
        start()
        add("Standup every day 10:30am r10m")
        checkbox("Standup").tap()
        expectRow("Standup", contains: "Tomorrow")
        relaunch(now: "2026-10-15T10:21:00Z")
        XCTAssertTrue(toast("Reminder: Standup").waitForExistence(timeout: 5))
        snap("recurring-reminders")
    }
}
