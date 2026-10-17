import OSLog
import SwiftUI

/// A failure shown to the user as `message`. Every report goes to the unified log (subsystem = bundle id, category
/// `errors`), so Xcode's console and Console.app show it, and to Sentry through `Telemetry`. DEBUG builds also print
/// `detail` under the message.
struct ErrorReport: Equatable {
    let message: String
    let detail: String

    private static let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "ProcrastiMate", category: "errors")

    /// `report` names the failure in Sentry. It is a `StaticString` so a name, a title, or a share token in `message`
    /// can never leave the device: a message built at runtime needs a constant `report` beside it.
    init(_ message: StaticString, detail: String) {
        self.init("\(message)", report: message, detail: detail)
    }

    init(_ message: StaticString, error: any Error) {
        self.init("\(message)", report: message, error: error)
    }

    init(_ message: String, report: StaticString, detail: String) {
        self.message = message
        self.detail = detail
        Self.write(message, report: report, detail: detail, error: nil)
    }

    init(_ message: String, report: StaticString, error: any Error) {
        self.message = message
        detail = String(reflecting: error)
        Self.write(message, report: report, detail: detail, error: error)
    }

    /// Logs a failure nobody sees on screen, such as a background step that falls back quietly.
    static func log(_ message: StaticString, detail: String) {
        write("\(message)", report: message, detail: detail, error: nil)
    }

    static func log(_ message: StaticString, error: any Error) {
        log("\(message)", report: message, error: error)
    }

    static func log(_ message: String, report: StaticString, error: any Error) {
        write(message, report: report, detail: String(reflecting: error), error: error)
    }

    private static func write(_ message: String, report: StaticString, detail: String, error: (any Error)?) {
        #if DEBUG
        logger.error("\(message, privacy: .public): \(detail, privacy: .public)")
        #else
        logger.error("\(message, privacy: .public): \(detail, privacy: .private)")
        #endif
        Telemetry.capture("\(report)", error: error)
    }
}

struct ErrorText: View {
    let report: ErrorReport

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(report.message).foregroundStyle(.toneOverdue)
            #if DEBUG
            Text(report.detail)
                .font(.caption2.monospaced())
                .foregroundStyle(.muted)
                .textSelection(.enabled)
            #endif
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
