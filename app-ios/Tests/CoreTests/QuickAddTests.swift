import Core
import Foundation
import Testing

/// Cases where ICU and JavaScript regular expressions differ, which the TS-recorded vectors cannot express.
@Suite struct QuickAddTests {
    @Test func handleThatOnlyICUCaseFoldsToALabelStaysText() throws {
        let labels = [Label(id: "l-calls", name: "calls", createdAt: 0)]
        let utc = try #require(TimeZone(identifier: "UTC"))
        let parsed = QuickAdd.parse("Ping @callſ", QuickAdd.Options(now: pinned, labels: labels), in: utc)
        #expect(parsed.title == "Ping @callſ")
        #expect(parsed.labelIds.isEmpty)
        #expect(parsed.tokens.isEmpty)
    }
}
