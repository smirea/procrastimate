import XCTest

/// The web's Web Push rows, as native local notifications. The pending requests come from the DEBUG readout on the
/// Notifications screen, since XCUITest cannot read `UNUserNotificationCenter`.
final class NotificationsParityTests: ParityTestCase {
    func test_push_sheet() {
        start()
        go("Browse")
        XCTAssertTrue(notificationsRow.label.hasSuffix("Off"), notificationsRow.label)
        openNotifications()
        XCTAssertTrue(heading("Get notified when tasks are due").exists)
        XCTAssertTrue(app.buttons["Turn on notifications"].exists)
        snap("push-sheet")
        app.buttons["Not now"].tap()
        XCTAssertTrue(app.navigationBars["Browse"].waitForExistence(timeout: 5))
    }

    func test_push_permission() {
        start()
        add("Call mom today 10:30am")
        XCTAssertFalse(springboard.alerts.firstMatch.waitForExistence(timeout: 1), "The app asked on its own")
        openNotifications()
        turnOnNotifications()
        go("Browse")
        XCTAssertTrue(notificationsRow.label.hasSuffix("On"), notificationsRow.label)

        launch(environment: ["PROCRASTIMATE_NOTIFICATIONS_DENIED": "1"])
        openNotifications()
        app.buttons["Turn on notifications"].tap()
        XCTAssertTrue(heading("Notifications are blocked").waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Open Settings › Notifications › Procrastimate and turn on Allow Notifications."].exists)
        XCTAssertTrue(app.buttons["Open Settings"].exists)
        snap("push-permission")
        app.navigationBars.buttons["Browse"].tap()
        XCTAssertTrue(notificationsRow.label.hasSuffix("Blocked"), notificationsRow.label)
    }

    func test_push_schedule() {
        start()
        openNotifications()
        turnOnNotifications()
        go("Inbox")
        add("Call mom today 10:30am r20m", "Taxes today", "Gym tomorrow 6pm", "Done today 11am")
        checkbox("Done").tap()
        waitGone(row("Done"))
        openNotifications()
        XCTAssertTrue(app.staticTexts["3 scheduled on this device"].waitForExistence(timeout: 5))
        expectPending([
            "Call mom@2026-10-14T10:10:00.000Z: Due at 10:30 AM",
            "Call mom@2026-10-14T10:30:00.000Z: Due now",
            "Gym@2026-10-15T18:00:00.000Z: Due now",
        ])
        snap("push-schedule")
    }

    func test_push_deliver() {
        start()
        openNotifications()
        turnOnNotifications()
        go("Inbox")
        add("Standup today 10:45am remind me at 10:45am")
        openNotifications()
        expectPending(["Standup@2026-10-14T10:45:00.000Z: Due now"])
        snap("push-deliver")
    }

    func test_push_test() {
        start()
        openNotifications()
        turnOnNotifications()
        app.buttons["Send a test notification"].tap()
        XCTAssertTrue(app.buttons["Sent"].waitForExistence(timeout: 5))
        snap("push-test")
        app.buttons["Turn off"].tap()
        XCTAssertTrue(heading("Get notified when tasks are due").waitForExistence(timeout: 5))
        app.navigationBars.buttons["Browse"].tap()
        XCTAssertTrue(notificationsRow.label.hasSuffix("Off"), notificationsRow.label)
    }

    func test_push_nudge() {
        start()
        let nudge = toast("Get notified when it’s due?")
        add("Buy milk")
        XCTAssertFalse(nudge.exists)
        add("Call mom today 10:30am")
        XCTAssertTrue(nudge.waitForExistence(timeout: 5))
        snap("push-nudge")
        app.buttons["Turn on"].tap()
        XCTAssertTrue(app.navigationBars["Notifications"].waitForExistence(timeout: 5))
        XCTAssertTrue(heading("Get notified when tasks are due").exists)
        go("Inbox")
        waitGone(nudge)
        add("Gym today 6pm")
        XCTAssertTrue(row("Gym").exists)
        XCTAssertFalse(nudge.exists)
    }

    /// Ten seconds before the due time, so the notification fires while the test waits on the Home Screen.
    func test_push_open() {
        launch(now: "2026-10-14T10:29:50Z")
        XCTAssertTrue(app.navigationBars["Inbox"].waitForExistence(timeout: 10))
        openNotifications()
        turnOnNotifications()
        go("Inbox")
        add("Call mom today 10:30am")
        XCUIDevice.shared.press(.home)
        let banner = springboard.descendants(matching: .any)
            .matching(NSPredicate(format: "label CONTAINS 'Call mom'")).firstMatch
        XCTAssertTrue(banner.waitForExistence(timeout: 30), "No notification for Call mom")
        banner.tap()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 10))
        expectDetailsOpen()
        snap("push-open")
    }
}
