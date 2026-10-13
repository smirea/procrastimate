import Core
import Foundation
import Testing

@Suite struct QuickAddDraftTests {
    let utc = TimeZone(identifier: "UTC")!
    let today = "2026-10-14"
    let labels = [Label(id: "l-calls", name: "Calls", createdAt: 0)]

    func parse(_ draft: QuickAddDraft) -> QuickAdd.Parsed {
        draft.parse(now: pinned, projects: [], labels: labels, in: utc)
    }

    @Test func textWinsOverAPickAndAPickRemovesThePhrase() throws {
        var draft = QuickAddDraft(defaults: .init(today: true), today: today)
        draft.setText("Call mom tomorrow  p1 now")
        var parsed = parse(draft)
        #expect(draft.resolved(parsed).due == Due(date: "2026-10-15", time: nil))
        #expect(draft.resolved(parsed).priority == .p1)

        draft.clearToken(.due, in: parsed)
        draft.picked.due = Due(date: "2026-10-20", time: nil)
        #expect(draft.text == "Call mom p1 now")
        parsed = parse(draft)
        let task = try #require(draft.resolve(parsed))
        #expect(task.title == "Call mom now")
        #expect(task.due == Due(date: "2026-10-20", time: nil))
        #expect(task.priority == .p1)
    }

    @Test func keepAsTextLeavesThePhraseInTheTitleUntilTheFieldClears() throws {
        var draft = QuickAddDraft(defaults: .init(), today: today)
        draft.setText("Read Monday Night Club")
        let token = try #require(parse(draft).tokens.first)
        draft.keepAsText(token)
        let parsed = parse(draft)
        #expect(parsed.tokens.isEmpty)
        #expect(draft.resolve(parsed)?.title == "Read Monday Night Club")
        #expect(draft.resolve(parsed)?.due == nil)

        draft.setText("")
        draft.setText("Read Monday Night Club")
        #expect(parse(draft).tokens.count == 1)
    }

    @Test func defaultsApplyAndResetForTheNextTask() {
        var draft = QuickAddDraft(defaults: .init(projectId: "p-work", labelId: "l-calls", today: true), today: today)
        draft.setText("Ping Ana @calls")
        let resolved = draft.resolved(parse(draft))
        #expect(resolved.projectId == "p-work")
        #expect(resolved.labelIds == ["l-calls"])
        #expect(resolved.due == Due(date: today, time: nil))

        draft.picked.priority = .p2
        draft.reset(today: today)
        #expect(draft.text.isEmpty)
        #expect(draft.picked.priority == nil)
        #expect(draft.picked.projectId == "p-work")
    }

    @Test func anEmptyTitleSavesNothing() {
        var draft = QuickAddDraft(defaults: .init(), today: today)
        draft.setText("tomorrow")
        #expect(draft.resolve(parse(draft)) == nil)
    }

    @Test func insertingANameReplacesTheFragmentWithUTF16Offsets() {
        let inserted = QuickAddDraft.insertingName("Calls", sigil: "@", into: "😀 call @ca   later", from: 8, to: 11)
        #expect(inserted.text == "😀 call @Calls later")
        #expect(inserted.caret == 15)
    }

    @Test func labelChipsNameTheLabelIgnoringCase() throws {
        var draft = QuickAddDraft(defaults: .init(), today: today)
        draft.setText("Ping @CALLS")
        let token = try #require(parse(draft).tokens.first { $0.kind == .label })
        #expect(QuickAddDraft.labelName(token, labels) == "Calls")
    }

    @Test func aRambleReplacesTheFieldAndKeepsListDefaultsOnlyWhereSpeechWasSilent() throws {
        var draft = QuickAddDraft(defaults: .init(projectId: "p-work", labelId: "l-calls", today: true), today: today)
        draft.setText("something else")
        draft.picked.priority = .p2
        let ramble = RambleDraft(
            tasks: [
                RambleTask(
                    segment: RambleSpan(start: 0, end: 8),
                    title: "Pay rent",
                    projectId: "spoken"
                ),
            ],
            tokens: [],
            ended: false
        )
        let applied = draft.applyRamble(ramble, today: today)
        #expect(applied)
        let task = try #require(draft.resolve(parse(draft)))
        #expect(task.title == "Pay rent")
        #expect(task.projectId == "spoken")
        #expect(task.labelIds == ["l-calls"])
        #expect(task.due == Due(date: today, time: nil))
        #expect(task.priority == .default)
    }

    @Test func nextWeekIsTheComingMonday() {
        #expect(QuickAddDraft.datePresets(today).map(\.date) == ["2026-10-14", "2026-10-15", "2026-10-19"])
        #expect(QuickAddDraft.datePresets("2026-10-19").last?.date == "2026-10-26")
    }
}
