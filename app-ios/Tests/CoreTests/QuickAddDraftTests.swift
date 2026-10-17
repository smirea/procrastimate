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
        var draft = QuickAddDraft(defaults: .init(date: today))
        draft.setText("Call mom tomorrow  p1 now")
        var parsed = parse(draft)
        #expect(draft.resolved(parsed).due == Due(date: "2026-10-15", time: nil))
        #expect(draft.resolved(parsed).priority == .p1)

        draft.clearTokens(.due, now: pinned, projects: [], labels: labels, in: utc)
        draft.picked.due = Due(date: "2026-10-20", time: nil)
        #expect(draft.text == "Call mom p1 now")
        parsed = parse(draft)
        let task = try #require(draft.resolve(parsed))
        #expect(task.title == "Call mom now")
        #expect(task.due == Due(date: "2026-10-20", time: nil))
        #expect(task.priority == .p1)
    }

    @Test func aSectionDefaultStaysOnlyInItsProjectAndSlashPicksAnother() throws {
        let projects = [Project(id: "p-home", name: "Home", createdAt: 0), Project(id: "p-work", name: "Work", createdAt: 0)]
        let sections = [
            ProjectSection(id: "s-next", projectId: "p-home", name: "Next up", createdAt: 0),
            ProjectSection(id: "s-later", projectId: "p-home", name: "Later", createdAt: 0),
        ]
        let parse = { (draft: QuickAddDraft) in
            draft.parse(now: pinned, projects: projects, sections: sections, labels: [], in: utc)
        }
        var draft = QuickAddDraft(defaults: .init(projectId: "p-home", sectionId: "s-next"))
        draft.setText("Paint door")
        #expect(try #require(draft.resolve(parse(draft))).sectionId == "s-next")
        draft.setText("Paint door /later")
        let later = try #require(draft.resolve(parse(draft)))
        #expect([later.title, later.projectId, later.sectionId] == ["Paint door", "p-home", "s-later"])
        draft.setText("Paint door #Work")
        let work = try #require(draft.resolve(parse(draft)))
        #expect(work.projectId == "p-work")
        #expect(work.sectionId == nil)
    }

    @Test func defaultsApplyAndResetForTheNextTask() {
        var draft = QuickAddDraft(defaults: .init(projectId: "p-work", labelId: "l-calls", date: today))
        draft.setText("Ping Ana @calls")
        let resolved = draft.resolved(parse(draft))
        #expect(resolved.projectId == "p-work")
        #expect(resolved.labelIds == ["l-calls"])
        #expect(resolved.due == Due(date: today, time: nil))

        draft.picked.priority = .p2
        draft.reset()
        #expect(draft.text.isEmpty)
        #expect(draft.picked.priority == nil)
        #expect(draft.picked.projectId == "p-work")
    }

    @Test func anEmptyTitleSavesNothing() {
        var draft = QuickAddDraft(defaults: .init())
        draft.setText("tomorrow")
        #expect(draft.resolve(parse(draft)) == nil)
    }

    @Test func insertingANameReplacesTheFragmentWithUTF16Offsets() {
        let inserted = QuickAddDraft.insertingName("Calls", sigil: "@", into: "😀 call @ca   later", from: 8, to: 11)
        #expect(inserted.text == "😀 call @Calls later")
        #expect(inserted.caret == 15)
    }

    @Test func labelChipsNameTheLabelIgnoringCase() throws {
        var draft = QuickAddDraft(defaults: .init())
        draft.setText("Ping @CALLS")
        let token = try #require(parse(draft).tokens.first { $0.kind == .label })
        #expect(QuickAddDraft.labelName(token, labels) == "Calls")
    }

    @Test func aPickClearsEveryCopyOfARepeatedPhrase() {
        var draft = QuickAddDraft(defaults: .init())
        draft.setText("Water every mon every fri p1")
        draft.clearTokens(.recurrence, now: pinned, projects: [], labels: labels, in: utc)
        #expect(draft.text == "Water p1")
    }

    @Test func removingSeveralTokensCutsEachPhrase() {
        var draft = QuickAddDraft(defaults: .init())
        draft.setText("Ping @calls tomorrow every day p1")
        let tokens = parse(draft).tokens.filter { $0.kind == .label || $0.kind == .recurrence }
        draft.removeTokens(tokens)
        #expect(draft.text == "Ping tomorrow p1")
    }

    @Test func nextWeekIsTheComingMonday() {
        #expect(QuickAddDraft.datePresets(today).map(\.date) == ["2026-10-14", "2026-10-15", "2026-10-19"])
        #expect(QuickAddDraft.datePresets("2026-10-19").last?.date == "2026-10-26")
    }
}
