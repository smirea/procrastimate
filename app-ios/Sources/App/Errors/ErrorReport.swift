import OSLog
import SwiftUI

/// A failure shown to the user as `message`. Every report goes to the unified log (subsystem = bundle id, category
/// `errors`), so Xcode's console and Console.app show it, and DEBUG builds also print `detail` under the message.
struct ErrorReport: Equatable {
    let message: String
    let detail: String

    private static let log = Logger(subsystem: Bundle.main.bundleIdentifier ?? "ProcrastiMate", category: "errors")

    init(_ message: String, detail: String) {
        self.message = message
        self.detail = detail
        #if DEBUG
        Self.log.error("\(message, privacy: .public): \(detail, privacy: .public)")
        #else
        Self.log.error("\(message, privacy: .public): \(detail, privacy: .private)")
        #endif
    }

    init(_ message: String, error: any Error) {
        self.init(message, detail: String(reflecting: error))
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
