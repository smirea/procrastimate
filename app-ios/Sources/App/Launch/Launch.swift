import Core
import Foundation
import SwiftUI

enum Launch {
    /// Applies the DEBUG launch environment before the first frame and returns the clock the app runs on.
    static func prepare() -> AppClock {
        #if DEBUG
        let options: LaunchOptions
        do {
            options = try LaunchOptions.parse(ProcessInfo.processInfo.environment)
        } catch {
            fatalError(error.description)
        }
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
}
