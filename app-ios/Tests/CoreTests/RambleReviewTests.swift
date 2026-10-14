import Core
import Foundation
import Testing

@Suite struct RambleReviewTests {
    func task(_ title: String, subtasks: [String] = [], projectId: String? = nil, due: Due? = nil) -> RambleTask {
        RambleTask(
            segment: RambleSpan(start: 0, end: title.utf16.count),
            title: title,
            due: due,
            projectId: projectId,
            subtasks: subtasks.map { RambleTask(segment: RambleSpan(start: 0, end: 0), title: $0) }
        )
    }

    func shape(_ tasks: [RambleTask]) -> [String] {
        tasks.map { $0.subtasks.isEmpty ? $0.title : "\($0.title) [\($0.subtasks.map(\.title).joined(separator: ", "))]" }
    }

    @Test func itemsInATitleBecomeSubtasks() {
        let tasks = [task("Buy groceries for the party, milk, eggs and bread", due: Due(date: "2026-10-15", time: nil))]
        let reviewed = Ramble.reviewed(tasks, by: [RambleReview(number: 1, role: .task, items: ["milk", "eggs", "bread"])], in: "")
        #expect(shape(reviewed) == ["Buy groceries for the party [Milk, Eggs, Bread]"])
        #expect(reviewed[0].due == Due(date: "2026-10-15", time: nil))
    }

    @Test func itemsTheTitleDoesNotSayAreIgnored() {
        let tasks = [task("Buy groceries for the party")]
        let reviewed = Ramble.reviewed(tasks, by: [RambleReview(number: 1, role: .task, items: ["milk", "eggs"])], in: "")
        #expect(shape(reviewed) == ["Buy groceries for the party"])
    }

    @Test func oneItemOrAShortLeadKeepsTheTitle() {
        let tasks = [task("Email the landlord about the heater"), task("Buy milk, eggs")]
        let reviewed = Ramble.reviewed(tasks, by: [
            RambleReview(number: 1, role: .task, items: ["heater"]),
            RambleReview(number: 2, role: .task, items: ["milk", "eggs"]),
        ], in: "")
        #expect(shape(reviewed) == ["Email the landlord about the heater", "Buy milk, eggs"])
    }

    @Test func aTaskContinuesTheListBeforeIt() {
        let tasks = [task("Plan the party", subtasks: ["Book a venue"]), task("Send invites", projectId: "p-home"), task("Call Dan")]
        let reviewed = Ramble.reviewed(tasks, by: [
            RambleReview(number: 1, role: .task),
            RambleReview(number: 2, role: .subtaskOfPrevious),
            RambleReview(number: 3, role: .task),
        ], in: "")
        #expect(shape(reviewed) == ["Plan the party [Book a venue, Send invites]", "Call Dan"])
        #expect(reviewed[0].subtasks[1].projectId == nil)
    }

    @Test func twoPlainTasksNeverMerge() {
        let tasks = [task("Buy milk"), task("Call the plumber about the leak")]
        let reviewed = Ramble.reviewed(tasks, by: [
            RambleReview(number: 1, role: .task),
            RambleReview(number: 2, role: .subtaskOfPrevious),
        ], in: "")
        #expect(shape(reviewed) == ["Buy milk", "Call the plumber about the leak"])
    }

    @Test func droppingAndMergingAreLeftToTheGrammar() {
        let tasks = [task("Pay rent"), task("Water the lawn")]
        let reviewed = Ramble.reviewed(tasks, by: [
            RambleReview(number: 1, role: .takenBack),
            RambleReview(number: 2, role: .partOfPrevious),
        ], in: "")
        #expect(shape(reviewed) == ["Pay rent", "Water the lawn"])
    }

    @Test func twoObjectsJoinedByAndStayOneTask() {
        let tasks = [task("Buy a new phone case and a screen protector")]
        let reviewed = Ramble.reviewed(tasks, by: [
            RambleReview(number: 1, role: .task, items: ["phone case", "screen protector"]),
        ], in: "")
        #expect(shape(reviewed) == ["Buy a new phone case and a screen protector"])
    }

    @Test func aSpokenNextTaskEndsTheList() {
        let transcript = "Plan the offsite with subtasks pick a venue. Next task email Dana."
        var parent = task("Plan the offsite", subtasks: ["Pick a venue"])
        parent.segment = RambleSpan(start: 0, end: 43)
        var next = task("Email Dana")
        next.segment = RambleSpan(start: 55, end: 65)
        let reviewed = Ramble.reviewed([parent, next], by: [
            RambleReview(number: 1, role: .task),
            RambleReview(number: 2, role: .subtaskOfPrevious),
        ], in: transcript)
        #expect(shape(reviewed) == ["Plan the offsite [Pick a venue]", "Email Dana"])
    }

    @Test func listDefaultsFillWhatTheSpeechLeftEmpty() {
        let defaults = QuickAddDraft.Defaults(projectId: "p-work", labelId: "l-calls", today: true)
        let spoken = Ramble.newTask(task("Call Ana", projectId: "p-home"), defaults: defaults, today: "2026-10-14")
        #expect(spoken.projectId == "p-home")
        #expect(spoken.labelIds == ["l-calls"])
        #expect(spoken.due == Due(date: "2026-10-14", time: nil))
        let subtask = Ramble.newTask(task("Bring the slides"), defaults: nil, today: "2026-10-14")
        #expect(subtask.projectId == nil)
        #expect(subtask.labelIds == [])
        #expect(subtask.due == nil)
    }
}
