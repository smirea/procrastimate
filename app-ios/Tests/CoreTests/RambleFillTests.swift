import Core
import Foundation
import Testing

@Suite struct RambleFillTests {
    func task(_ title: String, due: Due? = nil, priority: Priority? = nil, projectId: String? = nil) -> RambleTask {
        RambleTask(segment: RambleSpan(start: 0, end: title.utf16.count), title: title, due: due, priority: priority, projectId: projectId)
    }

    @Test func oneTaskKeepsItsTitleAndMetadata() {
        let draft = RambleDraft(
            tasks: [task("Call mom", due: Due(date: "2026-10-15", time: "17:00"), priority: .p1, projectId: "p-home")],
            tokens: [],
            ended: false
        )
        let fill = Ramble.quickAdd(from: draft)
        #expect(fill?.text == "Call mom")
        #expect(fill?.due == Due(date: "2026-10-15", time: "17:00"))
        #expect(fill?.priority == .p1)
        #expect(fill?.projectId == "p-home")
    }

    @Test func severalTasksBecomeOneTitleWithoutADate() {
        let draft = RambleDraft(
            tasks: [task("Buy milk"), task("Call the plumber", due: Due(date: "2026-10-15", time: nil))],
            tokens: [],
            ended: false
        )
        let fill = Ramble.quickAdd(from: draft)
        #expect(fill?.text == "Buy milk. Call the plumber")
        #expect(fill?.due == nil)
    }

    @Test func anEmptyDraftFillsNothing() {
        let draft = RambleDraft(tasks: [], tokens: [], ended: true)
        #expect(Ramble.quickAdd(from: draft) == nil)
    }
}
