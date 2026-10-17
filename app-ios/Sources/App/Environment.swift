import Foundation

enum AppEnvironment {
    static var apiURL: URL {
        guard let value = Bundle.main.object(forInfoDictionaryKey: "API_URL") as? String,
              let url = URL(string: value),
              let scheme = url.scheme, ["http", "https"].contains(scheme),
              url.host != nil else {
            fatalError("Missing API_URL. Run env-manager gen --local and build with Xcode or the run launcher.")
        }
        return url
    }

    /// The public DSN of Sentry project `procrastimate-ios` in org `self-uo7`. Empty means not provisioned, which a Release
    /// build refuses: `scripts/archive` will not archive it and the app stops at launch.
    static let sentryDSN = ""

    /// Where this build reports crashes, errors, and traces, or nil when it reports nothing. Only Release sets
    /// `SENTRY_ENVIRONMENT` (in `Config/Base.xcconfig`), so simulator, launcher, and UI test builds never send.
    static var telemetry: (dsn: String, environment: String)? {
        let environment = Bundle.main.object(forInfoDictionaryKey: "SENTRY_ENVIRONMENT") as? String ?? ""
        guard !environment.isEmpty else { return nil }
        guard !sentryDSN.isEmpty else {
            fatalError("SENTRY_ENVIRONMENT is \(environment) but AppEnvironment.sentryDSN is empty.")
        }
        return (sentryDSN, environment)
    }
}
