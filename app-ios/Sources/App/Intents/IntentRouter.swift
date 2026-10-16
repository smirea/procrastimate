import Observation
import SwiftUI

@MainActor @Observable
final class IntentRouter {
    var harnessLog = ""
    var spotlight = ""

    func note(_ line: String) {
        #if DEBUG
        guard ProcessInfo.processInfo.environment["PROCRASTIMATE_INTENTS"] != nil else { return }
        harnessLog = harnessLog.isEmpty ? line : "\(harnessLog)\n\(line)"
        #endif
    }
}

/// Hidden identifiers so an XCUITest can read what an intent did and which tasks were indexed. The text sits in the
/// accessibility identifier, the same way the notification schedule does. Release builds omit it.
struct IntentReadout: View {
    @Environment(IntentRouter.self) private var router

    var body: some View {
        #if DEBUG
        // Clear points, not drawn text: a clipped label drops out of the accessibility tree, and drawn text would land
        // in every other test's screenshot.
        HStack(spacing: 0) {
            Color.clear
                .frame(width: 1, height: 1)
                .accessibilityElement(children: .ignore)
                .accessibilityIdentifier("Intent results: \(results)")
                .accessibilityLabel(results)
            Color.clear
                .frame(width: 1, height: 1)
                .accessibilityElement(children: .ignore)
                .accessibilityIdentifier("Spotlight index: \(indexed)")
                .accessibilityLabel(indexed)
        }
        .allowsHitTesting(false)
        #else
        Color.clear.frame(width: 0, height: 0).accessibilityHidden(true)
        #endif
    }

    private var results: String { router.harnessLog.isEmpty ? "Intent results" : router.harnessLog }
    private var indexed: String { router.spotlight.isEmpty ? "none" : router.spotlight }
}
