import Foundation
import Sentry
import SwiftUI

/// The app's only use of Sentry. Until `start` runs, and in builds that report nothing, the SDK ignores every call, so
/// callers never check whether reporting is on.
enum Telemetry {
    /// Call first thing at launch, so a crash during the rest of launch is still reported.
    @MainActor static func start() {
        guard let target = AppEnvironment.telemetry else { return }
        SentrySDK.start { options in
            options.dsn = target.dsn
            options.environment = target.environment
            options.tracesSampleRate = 1
            // Only API requests carry `sentry-trace` and `baggage`, so the Worker continues the app's traces and no
            // other host receives them.
            options.tracePropagationTargets = [AppEnvironment.apiURL.host() ?? ""]
            // The SDK's own 5xx events duplicate the `ErrorReport` each failed call already sends, and its tap
            // transactions only see UIKit internals in a SwiftUI app (a text field tap read keyboard plists).
            options.enableCaptureFailedRequests = false
            options.enableUserInteractionTracing = false
            // sentry-cocoa 9 copies each request's query into its span and breadcrumb, and `GET /api/shared?token=`
            // carries a public link's token.
            options.beforeSendSpan = { span in
                span.removeData(key: "http.query")
                return span
            }
            options.beforeBreadcrumb = { breadcrumb in
                breadcrumb.data?.removeValue(forKey: "http.query")
                return breadcrumb
            }
        }
    }

    static func signedIn(_ userID: String) {
        SentrySDK.setUser(User(userId: userID))
    }

    static func signedOut() {
        SentrySDK.setUser(nil)
    }

    /// Sends a failure the app reported through `ErrorReport`, grouped by its message and the error's kind. Being offline
    /// is expected on a phone, so it is not sent. `detail` and the error's own description stay on the device: they can
    /// hold response bodies (an email on a failed sign-in) or URLs with share tokens.
    static func capture(_ message: String, error: (any Error)?) {
        if let error, isOffline(error) { return }
        let kind = error.map(kind) ?? "none"
        SentrySDK.capture(message: message) { scope in
            scope.setTag(value: message, key: "report")
            scope.setTag(value: kind, key: "error.kind")
            scope.setFingerprint([message, kind])
        }
    }

    /// The error's type and code, never its associated values.
    private static func kind(_ error: any Error) -> String {
        switch error {
        case let APIFailure.status(status, _): "APIFailure.status(\(status))"
        case let APIFailure.unreachable(underlying): "APIFailure.unreachable(\(kind(underlying)))"
        case let error as URLError: "URLError(\(error.code.rawValue))"
        default: "\(String(reflecting: type(of: error)))(\((error as NSError).domain) \((error as NSError).code))"
        }
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
