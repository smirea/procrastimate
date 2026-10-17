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
}
