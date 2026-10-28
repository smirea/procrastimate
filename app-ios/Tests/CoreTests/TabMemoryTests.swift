import Core
import Foundation
import Testing

@Suite struct TabMemoryTests {
    @Test func aTabHiddenFor30SecondsGoesStaleAndIsThenForgotten() {
        var memory = TabMemory<String>()
        memory.hide("inbox", at: pinned)
        #expect(memory.nextReset() == pinned.addingTimeInterval(30))
        #expect(memory.stale(at: pinned.addingTimeInterval(29.9)) == [])
        #expect(memory.stale(at: pinned.addingTimeInterval(30)) == ["inbox"])
        #expect(memory.stale(at: pinned.addingTimeInterval(90)) == [])
        #expect(memory.nextReset() == nil)
    }

    @Test func showingATabWithin30SecondsKeepsIt() {
        var memory = TabMemory<String>()
        memory.hide("inbox", at: pinned)
        memory.show("inbox")
        #expect(memory.stale(at: pinned.addingTimeInterval(60)) == [])
    }

    @Test func eachTabCountsFromWhenItWasHidden() {
        var memory = TabMemory<String>()
        memory.hide("inbox", at: pinned)
        memory.hide("browse", at: pinned.addingTimeInterval(20))
        #expect(memory.nextReset() == pinned.addingTimeInterval(30))
        #expect(memory.stale(at: pinned.addingTimeInterval(35)) == ["inbox"])
        #expect(memory.nextReset() == pinned.addingTimeInterval(50))
        #expect(memory.stale(at: pinned.addingTimeInterval(50)) == ["browse"])
    }

    @Test func goingToTheBackgroundDoesNotRestartAHiddenTabsClock() {
        var memory = TabMemory<String>()
        memory.hide("inbox", at: pinned)
        memory.hide("inbox", at: pinned.addingTimeInterval(25))
        #expect(memory.stale(at: pinned.addingTimeInterval(30)) == ["inbox"])
    }

    @Test func aKeptTabStaysUntilShown() {
        var memory = TabMemory<String>()
        memory.hide("inbox", at: pinned)
        memory.hide("browse", at: pinned)
        #expect(memory.stale(at: pinned.addingTimeInterval(40), keeping: "inbox") == ["browse"])
        #expect(memory.nextReset(keeping: "inbox") == nil)
        memory.show("inbox")
        #expect(memory.stale(at: pinned.addingTimeInterval(80)) == [])
    }
}
