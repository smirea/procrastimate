import Core
import Foundation
import Testing

@Suite struct RambleStructureTests {
    let zone = TimeZone(identifier: "UTC")!
    let now = Date(timeIntervalSince1970: 1791986400)

    func structured(_ transcript: String, _ split: [RambleSplit]) -> [String]? {
        let draft = Ramble.parse(transcript, now: now, in: zone)
        return Ramble.structured(split, transcript: transcript, draft: draft, now: now, in: zone)?.map { task in
            var shape = task.title
            if let due = task.due { shape += " @\(due.date)\(due.time.map { " \($0)" } ?? "")" }
            if !task.reminders.isEmpty { shape += " \(task.reminders)" }
            if !task.subtasks.isEmpty { shape += " [\(task.subtasks.map(\.title).joined(separator: ", "))]" }
            return shape
        }
    }

    let supermarket = "Go to the supermarket at 6pm and there get squid, garlic and some mayo. And then I also need to go swimming at 9am, so remind me 10 minutes before."

    @Test func listedItemsBecomeSubtasksAndTheGrammarReadsTheFields() {
        let shape = structured(supermarket, [
            RambleSplit(text: "go to the supermarket at 6pm", subtasks: ["squid", "garlic", "some mayo"]),
            RambleSplit(text: "go swimming at 9am, so remind me 10 minutes before"),
        ])
        #expect(shape == [
            "Go to the supermarket @2026-10-14 18:00 [Squid, Garlic, Some mayo]",
            "Go swimming @2026-10-15 09:00 [Core.API.Reminder.before(minutes: 10)]",
        ])
    }

    @Test func aReminderCopiedIntoTwoTasksKeepsTheGrammar() {
        let shape = structured(supermarket, [
            RambleSplit(text: "go to the supermarket at 6pm, remind me 10 minutes before", subtasks: ["squid", "garlic", "some mayo"]),
            RambleSplit(text: "go swimming at 9am, so remind me 10 minutes before"),
        ])
        #expect(shape == nil)
    }

    @Test func wordsTheSpeakerDidNotSayKeepTheGrammar() {
        #expect(structured("Call mom and water the plants", [RambleSplit(text: "go to the store at 5pm"), RambleSplit(text: "call mom")]) == nil)
    }

    @Test func aDroppedTaskKeepsTheGrammar() {
        #expect(structured("I need to book a dentist appointment, and then also cancel the gym membership.", [
            RambleSplit(text: "book a dentist appointment"),
        ]) == nil)
    }

    @Test func aDroppedTaskSharingAVerbKeepsTheGrammar() {
        #expect(structured("Call Alice. Call Bob.", [RambleSplit(text: "call Alice")]) == nil)
    }

    @Test func aDroppedPriorityKeepsTheGrammar() {
        #expect(structured("Pay the electricity bill on Friday priority 1", [RambleSplit(text: "pay the electricity bill on Friday")]) == nil)
    }

    @Test func aReorderedRemindMeLeavesTheTitle() {
        #expect(structured("Remind me to call Ben at 5pm. Pack the gym bag.", [
            RambleSplit(text: "call Ben at 5pm, remind me"),
            RambleSplit(text: "pack the gym bag"),
        ]) == ["Call Ben @2026-10-14 17:00", "Pack the gym bag"])
    }

    @Test func aRestatedOrLoneItemIsNotAList() {
        #expect(structured("Clean out the fridge and call the bank", [
            RambleSplit(text: "clean out the fridge", subtasks: ["fridge"]),
            RambleSplit(text: "call the bank", subtasks: ["the bank"]),
        ]) == ["Clean out the fridge", "Call the bank"])
    }

    @Test func aToDoWithoutAListKeepsTheGrammarsSplit() {
        #expect(structured("Get gas and wash the car.", [RambleSplit(text: "get gas and wash the car")]) == ["Get gas", "Wash the car"])
    }

    @Test func spokenCommandsSkipTheModel() {
        #expect(Ramble.usesCommands(Ramble.parse("Clean garage. Subtask sort tools.", now: now, in: zone)))
        #expect(Ramble.usesCommands(Ramble.parse("Buy paint next task call mom", now: now, in: zone)))
        #expect(!Ramble.usesCommands(Ramble.parse(supermarket, now: now, in: zone)))
    }

    @Test func listDefaultsFillWhatTheSpeechLeftEmpty() {
        let defaults = QuickAddDraft.Defaults(projectId: "p-work", labelId: "l-calls", today: true)
        let spoken = Ramble.newTask(
            RambleTask(segment: RambleSpan(start: 0, end: 8), title: "Call Ana", projectId: "p-home"),
            defaults: defaults,
            today: "2026-10-14"
        )
        #expect(spoken.projectId == "p-home")
        #expect(spoken.labelIds == ["l-calls"])
        #expect(spoken.due == Due(date: "2026-10-14", time: nil))
        let subtask = Ramble.newTask(RambleTask(segment: RambleSpan(start: 0, end: 16), title: "Bring the slides"), defaults: nil, today: "2026-10-14")
        #expect(subtask.projectId == nil)
        #expect(subtask.labelIds == [])
        #expect(subtask.due == nil)
    }
}
