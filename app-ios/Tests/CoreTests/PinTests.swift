import Core
import Testing

@Suite struct PinTests {
    let pins: [Pin] = [.inbox, .project(id: "house"), .label(id: "phone")]

    @Test func aMissingProjectKeepsItsPin() {
        #expect(pins.following(.project(id: "house"), to: nil) == pins)
    }

    @Test func aMergedProjectMovesItsPinToTheSurvivor() {
        #expect(
            pins.following(.project(id: "house"), to: .project(id: "home"))
                == [.inbox, .project(id: "home"), .label(id: "phone")]
        )
    }

    @Test func aMergeIntoAPinnedSurvivorDropsThePin() {
        let pinned: [Pin] = pins + [.project(id: "home")]
        #expect(
            pinned.following(.project(id: "house"), to: .project(id: "home"))
                == [.inbox, .label(id: "phone"), .project(id: "home")]
        )
    }

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
