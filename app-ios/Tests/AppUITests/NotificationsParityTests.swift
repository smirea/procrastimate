import XCTest

/// Notifications are one settings line. Permission is asked on first launch. The schedule itself is covered by
/// `NotificationScheduleTests`, since the Notifications screen and its pending readout are gone.
final class NotificationsParityTests: ParityTestCase {
    func test_push_sheet() {
        start()
        openSettings()
        XCTAssertTrue(
            app.staticTexts["Notifications: Off"].exists
                || app.staticTexts["Notifications: On"].exists
                || app.buttons["Notifications need permission"].exists
        )
        XCTAssertFalse(app.buttons["Turn on notifications"].exists)
        snap("push-sheet")
        closeSettings()
    }

    func test_push_permission() {
        launch(environment: ["PROCRASTIMATE_NOTIFICATIONS_DENIED": "1"])
        openSettings()
        XCTAssertTrue(app.buttons["Notifications need permission"].waitForExistence(timeout: 5))
        snap("push-permission")
        closeSettings()
    }

    func test_push_nudge() {
        start()
        add("Buy milk")
        add("Call mom today 10:30am")
        XCTAssertTrue(row("Call mom").exists)
        XCTAssertFalse(toast("Get notified when it’s due?").exists)
    }

    func test_push_open() {
        launch(now: "2026-10-14T10:29:50Z")
        XCTAssertTrue(app.navigationBars["Inbox"].waitForExistence(timeout: 10))
        let allow = springboard.alerts.buttons["Allow"]
        if allow.waitForExistence(timeout: 3) { allow.tap() }
        add("Call mom today 10:30am")
        XCUIDevice.shared.press(.home)
        let banner = springboard.descendants(matching: .any)
            .matching(NSPredicate(format: "label CONTAINS 'Call mom'")).firstMatch
        XCTAssertTrue(banner.waitForExistence(timeout: 30), "No notification for Call mom")
        banner.tap()
        if !app.wait(for: .runningForeground, timeout: 5) {
            let top = springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.3, dy: 0.005))
            top.press(forDuration: 0.1, thenDragTo: springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.3, dy: 0.7)))
            XCTAssertTrue(banner.waitForExistence(timeout: 5), "Call mom is not in Notification Center")
            banner.tap()
        }
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 10))
        expectDetailsOpen()
        snap("push-open")
    }
}
