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

    /// `<commit count>.<yyyyMMdd>`, set by `scripts/archive` and `scripts/run` from `scripts/app-version.mts`.
    static var version: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
    }

    /// The public DSN of Sentry project `procrastimate-ios` in org `self-uo7`. Empty means not provisioned, which a Release
    /// build refuses: `scripts/archive` will not archive it and the app stops at launch.
    static let sentryDSN = "https://b975a641b1c9cd8b96701a6c6b9de1c6@o4512270794817536.ingest.us.sentry.io/4512271645605888"

    /// Where this build reports crashes, errors, and traces, or nil when it reports nothing. Release is pinned to
    /// `production` in `Config/Base.xcconfig`; Debug takes env-manager `dev`'s `SENTRY_ENVIRONMENT` through
    /// `bun run env:ios`, empty in CI. UI test and demo launches stay silent anyway (`Telemetry.start`).
    static var telemetry: (dsn: String, environment: String)? {
        let environment = Bundle.main.object(forInfoDictionaryKey: "SENTRY_ENVIRONMENT") as? String ?? ""
        guard !environment.isEmpty else { return nil }
        guard !sentryDSN.isEmpty else {
            fatalError("SENTRY_ENVIRONMENT is \(environment) but AppEnvironment.sentryDSN is empty.")
        }
        return (sentryDSN, environment)
    }
}
