import Core
import Foundation
import SwiftUI

enum Launch {
    /// DEBUG UI tests set this so the app opens without a Keychain session. Release never reads it.
    /// Written once in `prepare()` before the first frame, then only read.
    nonisolated(unsafe) static var signedIn = false
    /// DEBUG UI tests set this to keep sync disconnected. Written once in `prepare()`, like `signedIn`.
    nonisolated(unsafe) static var offline = false
    /// DEBUG UI tests set this to offer a camera on the simulator. Written once in `prepare()`, like `signedIn`.
    nonisolated(unsafe) static var cameraStub = false

    static func prepare() -> AppClock {
        #if DEBUG
        let options: LaunchOptions
        do {
            options = try LaunchOptions.parse(ProcessInfo.processInfo.environment)
        } catch {
            fatalError(error.description)
        }
        signedIn = options.signedIn
        offline = options.offline
        cameraStub = options.cameraStub
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
