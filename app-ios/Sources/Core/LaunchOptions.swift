import Foundation

/// The DEBUG launch environment XCUITests use to start at a pinned moment with an empty store.
public struct LaunchOptions: Equatable, Sendable {
    public static let nowKey = "PROCRASTIMATE_NOW"
    public static let timeZoneKey = "PROCRASTIMATE_TZ"
    public static let resetKey = "PROCRASTIMATE_RESET"

    /// Freezes the clock at this moment.
    public var now: Date?
    public var timeZone: TimeZone?
    /// Wipes the store and preferences before the first frame.
    public var reset: Bool

    public init(now: Date? = nil, timeZone: TimeZone? = nil, reset: Bool = false) {
        self.now = now
        self.timeZone = timeZone
        self.reset = reset
    }

    public enum Failure: Error, Equatable, CustomStringConvertible {
        case invalid(key: String, value: String)

        public var description: String {
            switch self {
            case let .invalid(key, value): "\(key) has an invalid value: \(value)"
            }
        }
    }

    /// Reads the options from a process environment. Unset keys keep the defaults; malformed values throw.
    public static func parse(_ environment: [String: String]) throws(Failure) -> LaunchOptions {
        var options = LaunchOptions()
        if let value = environment[nowKey] {
            guard let date = parseDate(value) else { throw .invalid(key: nowKey, value: value) }
            options.now = date
        }
        if let value = environment[timeZoneKey] {
            guard let zone = TimeZone(identifier: value) else { throw .invalid(key: timeZoneKey, value: value) }
            options.timeZone = zone
        }
        if let value = environment[resetKey] {
            switch value {
            case "1", "true": options.reset = true
            case "0", "false": options.reset = false
            default: throw .invalid(key: resetKey, value: value)
            }
        }
        return options
    }

    /// The clock these options pin, falling back to `system` for whatever they leave unset.
    public func clock(system: AppClock) -> AppClock {
        let zone = timeZone ?? system.timeZone
        if let now { return .fixed(now, timeZone: zone) }
        return AppClock(timeZone: zone, now: { system.now })
    }

    private static func parseDate(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        if let date = formatter.date(from: value) { return date }
        formatter.formatOptions.insert(.withFractionalSeconds)
        return formatter.date(from: value)
    }
}
