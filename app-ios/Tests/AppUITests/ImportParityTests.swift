import XCTest

/// CI copies `todoist-backup.zip`, `not-a-backup.zip`, and `notes.txt` into the app's Documents folder, which the
/// document picker lists under On My iPhone (`scripts/todoist-fixtures.ts`).
final class ImportParityTests: ParityTestCase {
    private let inbox = [
        "Call the dentist",
        "cancel [meetup.com](https://meetup.com)",
        "Renew passport #Travel",
        "Water plants",
        "Fix bike",
    ]

    func test_import_pick() {
        start()
        openSettings()
        pick("todoist-backup", snapping: "import-pick")
        XCTAssertTrue(importSummary.waitForExistence(timeout: 10))
    }

    func test_import_read() {
        start()
        openSettings()
        pick("todoist-backup")
        XCTAssertTrue(importSummary.waitForExistence(timeout: 10))
        closeSettings()
        go("Inbox")
        expectRows(inbox.count)
        for title in inbox { XCTAssertTrue(row(title).exists, "No row \(title)") }
        expectRow("Call the dentist", contains: "Oct 22")
        snap("import-read")
    }

    func test_import_summary() {
        start()
        openSettings()
        pick("todoist-backup")
        XCTAssertTrue(importSummary.waitForExistence(timeout: 10))
        for stat in ["2 projects", "12 tasks", "0 skipped"] { XCTAssertTrue(element(stat).exists, "No \(stat)") }
        XCTAssertTrue(app.staticTexts["3 labels added"].exists)
        XCTAssertTrue(element("3 warnings").exists)
        for warning in [
            "Inbox: could not read the date \"every! 3 days\" on \"Fix bike\", kept it in notes",
            "Long Term: sections are not imported: Someday, Reading",
            "Job: could not read the date \"jeden Montag\" on \"Email Sam\", kept it in notes",
        ] {
            XCTAssertTrue(app.staticTexts[warning].exists, "No warning \(warning)")
        }
        snap("import-summary")
    }

    func test_import_dedupe() {
        start()
        openSettings()
        pick("todoist-backup")
        XCTAssertTrue(element("12 tasks").waitForExistence(timeout: 10))
        pick("todoist-backup")
        XCTAssertTrue(element("12 skipped").waitForExistence(timeout: 10))
        XCTAssertTrue(element("0 projects").exists)
        XCTAssertTrue(element("0 tasks").exists)
        snap("import-dedupe")
        closeSettings()
        go("Inbox")
        expectRows(inbox.count)
    }

    func test_import_error() {
        start()
        openSettings()
        pick("not-a-backup")
        XCTAssertTrue(app.staticTexts["This is not a Todoist backup zip."].waitForExistence(timeout: 10))
        snap("import-error")
        closeSettings()
        go("Inbox")
        XCTAssertTrue(app.staticTexts["Inbox zero"].exists)
    }
}
