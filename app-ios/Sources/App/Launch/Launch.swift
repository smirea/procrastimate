import Core
import Foundation
import SwiftUI

enum Launch {
    /// DEBUG UI tests set this so the app opens without a Keychain session. Release never reads it.
    static var signedIn = false

    /// Applies the DEBUG launch environment before the first frame and returns the clock the app runs on.
    static func prepare() -> AppClock {
        #if DEBUG
        let options: LaunchOptions
        do {
            options = try LaunchOptions.parse(ProcessInfo.processInfo.environment)
        } catch {
            fatalError(error.description)
        }
        signedIn = options.signedIn
        if options.reset { StoreLocation.reset() }
        return options.clock(system: .system)
        #else
        return .system
        #endif
    }
}

extension AppClock {
    /// The only place the app reads the device's clock and time zone.
    static let system = AppClock(timeZone: .autoupdatingCurrent, now: { Date() })
}

extension EnvironmentValues {
    @Entry var clock: AppClock = .system
    /// The clock's day, which the app re-reads at midnight so date-based lists recompute while it stays open.
    @Entry var today: DateKey = AppClock.system.today
}
