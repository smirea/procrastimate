import Core
import Testing

@Suite struct EventTimingTests {
    @Test func pickingAnEventAloneIsTheStart() {
        let timing = EventTiming()
        #expect(timing.edge == .start)
        #expect(timing.minutes == 0)
    }

    @Test func eachAnchorAndDirectionWritesItsEdge() {
        #expect(EventTiming(anchor: .start, amount: 10, direction: .before).edge == .before)
        #expect(EventTiming(anchor: .start, amount: 2, unit: .hours, direction: .after).edge == .afterStart)
        #expect(EventTiming(anchor: .end, amount: 5, unit: .hours, direction: .before).edge == .beforeEnd)
        #expect(EventTiming(anchor: .end, amount: 1, unit: .days, direction: .after).edge == .after)
        #expect(EventTiming(anchor: .end, amount: 5, unit: .hours).minutes == 300)
        #expect(EventTiming(anchor: .end, amount: 3, unit: .weeks).minutes == 30_240)
    }

    @Test func noAmountIsTheAnchorWhicheverWay() {
        #expect(EventTiming(anchor: .start, direction: .after).edge == .start)
        #expect(EventTiming(anchor: .end, direction: .after).edge == .beforeEnd)
        #expect(EventTiming(anchor: .end, direction: .before).edge == .beforeEnd)
    }

    @Test func duringIgnoresTheAmount() {
        let timing = EventTiming(anchor: .during, amount: 4, unit: .hours)
        #expect(timing.edge == .during)
        #expect(timing.minutes == 0)
    }

    @Test func storedEdgesReadInTheirLargestUnit() {
        #expect(EventTiming(edge: .beforeEnd, minutes: 300) == EventTiming(anchor: .end, amount: 5, unit: .hours))
        #expect(EventTiming(edge: .before, minutes: 90) == EventTiming(anchor: .start, amount: 90))
        #expect(EventTiming(edge: .after, minutes: 2880) == EventTiming(anchor: .end, amount: 2, unit: .days, direction: .after))
        #expect(EventTiming(edge: .afterStart, minutes: 20_160) == EventTiming(anchor: .start, amount: 2, unit: .weeks, direction: .after))
        #expect(EventTiming(edge: .after, minutes: 0) == EventTiming(anchor: .end, direction: .after))
        #expect(EventTiming(edge: .start, minutes: 0) == EventTiming())
    }
}
