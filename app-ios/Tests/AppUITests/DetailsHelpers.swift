import XCTest

/// Task details handles shared by the details, subtasks, and recurring parity tests, named like the web's
/// `details-fixtures.ts`.
extension ParityTestCase {
    var titleInput: XCUIElement { app.textViews.matching(NSPredicate(format: "label == 'Title'")).firstMatch }
    var subtaskInput: XCUIElement { app.textViews.matching(NSPredicate(format: "label == 'Add subtask'")).firstMatch }

    /// A vertical `TextField` can surface as a text field or a text view.
    var notes: XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(
            format: "label == 'Notes' AND (elementType == %d OR elementType == %d)",
            XCUIElement.ElementType.textField.rawValue,
            XCUIElement.ElementType.textView.rawValue
        )).firstMatch
    }

    /// A toolbar `Menu` surfaces as a pop-up button rather than a button.
    func chip(_ name: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(
            format: "label == %@ AND (elementType == %d OR elementType == %d)",
            name,
            XCUIElement.ElementType.button.rawValue,
            XCUIElement.ElementType.popUpButton.rawValue
        )).firstMatch
    }

    func subtask(_ title: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: "subtask-\(title)").firstMatch
    }

    func subtaskCheckbox(_ title: String) -> XCUIElement { app.buttons["Complete \(title)"].firstMatch }

    func openDetails(_ title: String) {
        row(title).tap()
        XCTAssertTrue(titleInput.waitForExistence(timeout: 5))
        wait(for: titleInput, "value == '\(title)'")
    }

    func closeDetails() {
        app.buttons["Close"].firstMatch.tap()
        waitGone(titleInput)
    }

    /// Puts the caret at the end of the one-line title.
    func focusTitleEnd() {
        titleInput.coordinate(withNormalizedOffset: CGVector(dx: 0.98, dy: 0.5)).tap()
        wait(for: titleInput, "hasKeyboardFocus == true")
    }

    /// Replaces the title and presses return, which applies it.
    func retitle(_ title: String) {
        focusTitleEnd()
        let current = titleInput.value as? String ?? ""
        titleInput.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: current.count) + title + "\n")
    }

    func addSubtasks(_ titles: String...) { addSubtasks(titles) }

    func addSubtasks(_ titles: [String]) {
        subtaskInput.tap()
        wait(for: subtaskInput, "hasKeyboardFocus == true")
        for title in titles {
            subtaskInput.typeText(title + "\n")
            wait(for: subtaskInput, "value == ''")
        }
    }

    func addWithSubtasks(_ parent: String, _ titles: String...) {
        add(parent)
        openDetails(parent)
        addSubtasks(titles)
    }

    /// Subtask titles from top to bottom.
    func subtaskOrder(_ titles: [String]) -> [String] {
        titles.sorted { subtask($0).frame.minY < subtask($1).frame.minY }
    }

    func dismissPopover() {
        app.otherElements["PopoverDismissRegion"].firstMatch.tap()
    }
}
