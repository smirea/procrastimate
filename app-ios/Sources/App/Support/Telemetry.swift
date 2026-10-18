import Core
import Foundation
import Sentry
import SwiftUI

/// The app's only use of Sentry. Until `start` runs, and in builds that report nothing, the SDK ignores every call, so
/// callers never check whether reporting is on.
enum Telemetry {
    /// Call first thing at launch, so a crash during the rest of launch is still reported.
    @MainActor static func start() {
        guard let target = AppEnvironment.telemetry, !isHarnessRun else { return }
        SentrySDK.start { options in
            options.dsn = target.dsn
            options.environment = target.environment
            options.sendDefaultPii = true
            options.tracesSampleRate = 1
            // Only API requests carry `sentry-trace` and `baggage`, so the Worker continues the app's traces and no
            // other host receives them.
            options.tracePropagationTargets = [AppEnvironment.apiURL.host() ?? ""]
            // The SDK's own 5xx events duplicate the `ErrorReport` each failed call already sends, and its tap
            // transactions only see UIKit internals in a SwiftUI app (a text field tap read keyboard plists).
            options.enableCaptureFailedRequests = false
            options.enableUserInteractionTracing = false
        }
    }

    /// UI tests and demos drive the app through the launch environment, and their failures are not the user's.
    private static var isHarnessRun: Bool {
        let environment = ProcessInfo.processInfo.environment
        let keys = [
            LaunchOptions.nowKey, LaunchOptions.timeZoneKey, LaunchOptions.resetKey,
            LaunchOptions.notificationsDeniedKey, LaunchOptions.signedInKey, "PROCRASTIMATE_DEMO",
        ]
        return keys.contains { environment[$0] != nil }
    }

    static func signedIn(_ userID: String, email: String?, name: String?) {
        let user = User(userId: userID)
        user.email = email
        user.username = name
        SentrySDK.setUser(user)
    }

    static func signedOut() {
        SentrySDK.setUser(nil)
    }

    /// Sends a failure the app reported through `ErrorReport`, grouped by its message, with the error itself and the
    /// report's `detail`. Being offline is expected on a phone, so it is not sent.
    static func capture(_ message: String, detail: String, error: (any Error)?) {
        if let error, isOffline(error) { return }
        let scope: (Scope) -> Void = { scope in
            scope.setContext(value: ["message": message, "detail": detail], key: "report")
            scope.setFingerprint(["{{ default }}", message])
        }
        if let error {
            SentrySDK.capture(error: error, block: scope)
        } else {
            SentrySDK.capture(message: message, block: scope)
        }
    }

    /// `PROCRASTIMATE_SENTRY_SMOKE=1`, honored in Release too so production is provable: the Worker throws from its
    /// debug route, then the app reports its own error, all in one trace. `scripts/sentry-check.ts
    /// --expect ios` reads them back.
    static func smokeIfAsked() async {
        guard ProcessInfo.processInfo.environment["PROCRASTIMATE_SENTRY_SMOKE"] == "1", SessionToken.read() != nil else {
            return
        }
        let transaction = SentrySDK.startTransaction(name: "Sentry smoke", operation: "smoke", bindToScope: true)
        _ = try? await APIClient.send(API.Endpoints.DebugError.self, NoInput())
        reportSentrySmoke(in: transaction)
        transaction.finish()
    }

    /// Named, so the event's stack trace shows an in-app frame with this file and line.
    private static func reportSentrySmoke(in transaction: any Span) {
        let scope: (Scope) -> Void = { $0.span = transaction }
        SentrySDK.capture(exception: NSException(name: .init("SentrySmoke"), reason: "Sentry smoke test: iOS"), block: scope)
    }

    /// Times `body` as its own transaction. A bound transaction collects the SDK's automatic spans (API requests, file
    /// writes) that start while it runs, so bind only one that runs alone, like a sync cycle.
    static func trace<T>(
        _ name: String,
        operation: String,
        bindToScope: Bool = false,
        _ body: () throws -> T
    ) rethrows -> T {
        let transaction = SentrySDK.startTransaction(name: name, operation: operation, bindToScope: bindToScope)
        do {
            let value = try body()
            transaction.finish(status: .ok)
            return value
        } catch {
            transaction.finish(status: .internalError)
            throw error
        }
    }

    static func trace<T>(
        _ name: String,
        operation: String,
        bindToScope: Bool = false,
        isolation: isolated (any Actor)? = #isolation,
        _ body: () async throws -> T
    ) async rethrows -> T {
        let transaction = SentrySDK.startTransaction(name: name, operation: operation, bindToScope: bindToScope)
        do {
            let value = try await body()
            transaction.finish(status: .ok)
            return value
        } catch {
            transaction.finish(status: .internalError)
            throw error
        }
    }

    private static func isOffline(_ error: any Error) -> Bool {
        let error = if case let APIFailure.unreachable(underlying) = error { underlying } else { error }
        if error is CancellationError { return true }
        guard let error = error as? URLError else { return false }
        return [.notConnectedToInternet, .networkConnectionLost, .cancelled].contains(error.code)
    }
}

extension View {
    /// Times the screen's first appearance as a `ui.load` transaction. The first one also carries the app start.
    func tracedScreen(_ name: String) -> some View {
        sentryTrace(name)
    }
}
