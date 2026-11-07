import Core
import Foundation
import Testing

@Suite struct RecurrenceRangeTests {
    @Test(arguments: [RecurrenceUnit.day, .weekday, .week, .month, .year])
    func anIntervalTooLargeForTheMathHasNoNextOccurrenceInsteadOfTrapping(_ unit: RecurrenceUnit) {
        for interval in [Int.max, Int.max / 7, Dates.maxRecurrenceInterval + 1, 0, -1, Int.min] {
            #expect(Dates.stepRecurrence("2026-10-14", Recurrence(interval: interval, unit: unit)) == nil)
        }
        let task = Recurrence(interval: Int.max, unit: unit)
        #expect(Dates.nextOccurrence(due: Due(date: "2026-10-14", time: nil), recurrence: task, reminders: [], today: "2026-10-14") == nil)
    }

    @Test func aHugeMonthlyRepeatOnADayOrWeekdayHasNoNextOccurrence() {
        #expect(Dates.stepRecurrence("2026-10-14", Recurrence(interval: Int.max, unit: .month, day: 31)) == nil)
        let nth = NthWeekday(week: -1, weekday: 5)
        #expect(Dates.stepRecurrence("2026-10-14", Recurrence(interval: Int.max, unit: .month, nth: nth)) == nil)
    }

}
