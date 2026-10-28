import Foundation

/// The DEBUG launch environment XCUITests use to start at a pinned moment with an empty store.
public struct LaunchOptions: Equatable, Sendable {
    public static let nowKey = "PROCRASTIMATE_NOW"
    public static let timeZoneKey = "PROCRASTIMATE_TZ"
    public static let resetKey = "PROCRASTIMATE_RESET"
    public static let notificationsDeniedKey = "PROCRASTIMATE_NOTIFICATIONS_DENIED"
    public static let signedInKey = "PROCRASTIMATE_SIGNED_IN"
    public static let offlineKey = "PROCRASTIMATE_OFFLINE"
    public static let cameraStubKey = "PROCRASTIMATE_CAMERA_STUB"

    /// Freezes the clock at this moment.
    public var now: Date?
    public var timeZone: TimeZone?
    /// Wipes the store and preferences before the first frame.
    public var reset: Bool
    /// Answers the notification permission prompt with Don't Allow, without asking the system. The simulator keeps a
    /// real answer until the app is reinstalled, so a test that denies would block every later test.
    public var notificationsDenied: Bool
    /// DEBUG only. UI tests set this so the app opens without a Keychain session.
    public var signedIn: Bool
    /// DEBUG only. Keeps sync disconnected, so a UI test can edit offline and prove the edit uploads on the next launch.
    public var offline: Bool
    /// DEBUG only. The simulator has no camera, so this offers one whose shot is a generated image.
    public var cameraStub: Bool

    public init(
        now: Date? = nil,
        timeZone: TimeZone? = nil,
        reset: Bool = false,
        notificationsDenied: Bool = false,
        signedIn: Bool = false,
        offline: Bool = false,
        cameraStub: Bool = false
    ) {
        self.now = now
        self.timeZone = timeZone
        self.reset = reset
        self.notificationsDenied = notificationsDenied
        self.signedIn = signedIn
        self.offline = offline
        self.cameraStub = cameraStub
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
        options.reset = try flag(environment, resetKey)
        options.notificationsDenied = try flag(environment, notificationsDeniedKey)
        options.signedIn = try flag(environment, signedInKey)
        options.offline = try flag(environment, offlineKey)
        options.cameraStub = try flag(environment, cameraStubKey)
        return options
    }

    private static func flag(_ environment: [String: String], _ key: String) throws(Failure) -> Bool {
        switch environment[key] {
        case nil, "0", "false": false
        case "1", "true": true
        case let value?: throw .invalid(key: key, value: value)
        }
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
