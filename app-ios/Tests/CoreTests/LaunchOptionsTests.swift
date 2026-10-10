import Core
import Foundation
import Testing

/// Wednesday, October 14 2026, 10:00 UTC, the moment both test suites pin.
let pinned = Date(timeIntervalSince1970: 1_791_972_000)

@Suite struct LaunchOptionsTests {
    @Test func emptyEnvironmentKeepsDefaults() throws {
        #expect(try LaunchOptions.parse([:]) == LaunchOptions())
    }

    @Test func readsEveryKey() throws {
        let options = try LaunchOptions.parse([
            "PROCRASTIMATE_NOW": "2026-10-14T10:00:00Z",
            "PROCRASTIMATE_TZ": "America/New_York",
            "PROCRASTIMATE_RESET": "1",
        ])
        #expect(options == LaunchOptions(now: pinned, timeZone: TimeZone(identifier: "America/New_York"), reset: true))
    }

    @Test func acceptsFractionalSeconds() throws {
        #expect(try LaunchOptions.parse(["PROCRASTIMATE_NOW": "2026-10-14T10:00:00.000Z"]).now == pinned)
    }

    @Test(arguments: [
        ("PROCRASTIMATE_NOW", "tomorrow"),
        ("PROCRASTIMATE_TZ", "Mars/Olympus"),
        ("PROCRASTIMATE_RESET", "yes"),
    ])
    func rejectsMalformedValues(key: String, value: String) {
        #expect(throws: LaunchOptions.Failure.invalid(key: key, value: value)) {
            try LaunchOptions.parse([key: value])
        }
    }

    @Test func pinsTheClock() {
        let system = AppClock(timeZone: TimeZone(identifier: "Europe/Berlin")!, now: { Date(timeIntervalSince1970: 0) })
        let clock = LaunchOptions(now: pinned, timeZone: TimeZone(identifier: "UTC")).clock(system: system)
        #expect(clock.now == pinned)
        #expect(clock.calendar.component(.hour, from: clock.now) == 10)
        #expect(clock.calendar.component(.weekday, from: clock.now) == 4)
    }

    @Test func unsetOptionsFallBackToTheSystemClock() {
        let system = AppClock(timeZone: TimeZone(identifier: "Europe/Berlin")!, now: { pinned })
        let clock = LaunchOptions().clock(system: system)
        #expect(clock.now == pinned)
        #expect(clock.timeZone == system.timeZone)
        #expect(clock.calendar.component(.hour, from: clock.now) == 12)
    }
}
