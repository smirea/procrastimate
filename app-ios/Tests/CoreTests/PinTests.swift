import Core
import Testing

@Suite struct PinTests {
    @Test func editingTheShownPinsKeepsHiddenOnesInPlace() {
        let stored: [Pin] = [.inbox, .project(id: "gone"), .noDate, .label(id: "phone")]
        let shown: [Pin] = [.inbox, .noDate, .label(id: "phone")]
        #expect(
            stored.editing(shown: shown, to: [.label(id: "phone"), .inbox, .noDate])
                == [.label(id: "phone"), .project(id: "gone"), .inbox, .noDate]
        )
        #expect(
            stored.editing(shown: shown, to: [.inbox, .label(id: "phone")])
                == [.inbox, .project(id: "gone"), .label(id: "phone")]
        )
        #expect(
            stored.editing(shown: shown, to: shown + [.project(id: "house")])
                == stored + [.project(id: "house")]
        )
    }
}
