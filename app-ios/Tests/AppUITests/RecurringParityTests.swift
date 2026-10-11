import XCTest

final class RecurringParityTests: ParityTestCase {
    func test_recurring_display() {
        start()
        add("Standup every mon 9am", "Water plants every 3 days")
        expectRow("Standup", contains: "Repeats every Mon")
        expectRow("Water plants", contains: "Repeats every 3 days")
        snap("recurring-display")
    }
}
