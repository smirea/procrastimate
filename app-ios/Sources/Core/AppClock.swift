import Foundation

/// The only source of "now" and the time zone for `Core`. The app passes one in, so tests and vectors pin both.
public struct AppClock: Sendable {
    public let timeZone: TimeZone
    private let read: @Sendable () -> Date

    public init(timeZone: TimeZone, now: @escaping @Sendable () -> Date) {
        self.timeZone = timeZone
        self.read = now
    }

    /// A clock frozen at `date`, like Playwright's `clock.setFixedTime`.
    public static func fixed(_ date: Date, timeZone: TimeZone) -> AppClock {
        AppClock(timeZone: timeZone, now: { date })
    }

    public var now: Date { read() }

    public var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        return calendar
    }
}
