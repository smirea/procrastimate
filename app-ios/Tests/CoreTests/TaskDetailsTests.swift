import Core
import Foundation
import Testing

@Suite struct TaskDetailsTests {
    let utc = TimeZone(identifier: "UTC")!
    let today = "2026-10-14"
    let home = Project(id: "p-home", name: "Home", createdAt: 0)
    let calls = Label(id: "l-calls", name: "calls", createdAt: 0)

    func parse(_ title: String, _ task: TaskItem) -> QuickAdd.Parsed {
        TaskDetails.parse(title, task, now: pinned, projects: [home], labels: [calls], in: utc)
    }

    @Test func theDraftShowsWhatTheTitleWillApply() {
        let task = TaskItem(id: "t", title: "Water plants", labelIds: ["l-old"], reminders: [.before(minutes: 0)], createdAt: 0)
        let title = "Water plants fri 6pm !! remind me 1h before #Home @calls"
        let draft = TaskDetails.draft(task, title: title, parse(title, task))
        #expect(draft.title == "Water plants")
        #expect(draft.due == Due(date: "2026-10-16", time: "18:00"))
        #expect(draft.priority == .p2)
        #expect(draft.projectId == "p-home")
        #expect(draft.labelIds == ["l-old", "l-calls"])
        #expect(draft.reminders == [.before(minutes: 0), .before(minutes: 60)])
        #expect(TaskDetails.draft(task, title: task.title, parse(task.title, task)) == TaskDetails.Draft(task))
    }

    @Test func committingTheTitleSavesTheDraftOrReverts() {
        let task = TaskItem(id: "t", title: "Standup", priority: .p3, createdAt: 0)
        #expect(TaskDetails.commitTitle(task, title: "Standup", parse("Standup", task)) == .unchanged)
        #expect(TaskDetails.commitTitle(task, title: "tomorrow", parse("tomorrow", task)) == .revert)
        guard case let .update(patch, title) = TaskDetails.commitTitle(task, title: "Standup fri", parse("Standup fri", task)) else {
            Issue.record("Expected an update")
            return
        }
        #expect(title == "Standup")
        #expect(patch.due == .some(Due(date: "2026-10-16", time: nil)))
        #expect(patch.priority == .p3)
    }

    @Test func aSubtaskTitleKeepsAProjectHashtagAsText() {
        let subtask = TaskItem(id: "s", parentId: "t", title: "Charger", createdAt: 0)
        let parsed = parse("Charger #Home", subtask)
        #expect(parsed.title == "Charger #Home")
        #expect(parsed.projectId == nil)
    }

    @Test func removingTheDateRemovesTheRepeat() {
        let task = TaskItem(
            id: "t", title: "Standup", due: Due(date: today, time: nil), recurrence: Recurrence(interval: 1, unit: .day), createdAt: 0
        )
        #expect(TaskDetails.setDue(task, nil) == TaskPatch(due: .some(nil), recurrence: .some(nil)))
        let tomorrow = Due(date: "2026-10-15", time: nil)
        #expect(TaskDetails.setDue(task, tomorrow) == TaskPatch(due: .some(tomorrow), recurrence: .some(task.recurrence)))
    }
}

@Suite struct RepeatMenuTests {
    let today = "2026-10-14"
    let wednesday = Due(date: "2026-10-14", time: "09:00")

    @Test func aRepeatOnAnUndatedTaskDatesItToday() {
        let opened = RepeatMenu.anchor(nil, today: today)
        let set = RepeatMenu.set(Recurrence(interval: 1, unit: .day), opened: opened, due: nil)
        #expect(set.recurrence == Recurrence(interval: 1, unit: .day))
        #expect(set.due == Due(date: today, time: nil))
        #expect(RepeatMenu.set(nil, opened: opened, due: wednesday) == (nil, wednesday))
    }

    @Test func weekdayTogglesBuildASetFromThePlainWeeklyRepeat() {
        let weekly = Recurrence(interval: 1, unit: .week)
        #expect(RepeatMenu.weekdays(weekly, anchor: wednesday) == [3])
        #expect(RepeatMenu.weekdays(Recurrence(interval: 1, unit: .day), anchor: wednesday) == [])

        let friday = RepeatMenu.toggling(5, weekly, anchor: wednesday)
        #expect(friday == Recurrence(interval: 1, unit: .week, days: [3, 5]))
        let monday = RepeatMenu.toggling(1, friday, anchor: wednesday)
        #expect(monday.days == [1, 3, 5])
        #expect(RepeatMenu.set(monday, opened: wednesday, due: wednesday).due == wednesday)
        #expect(!RepeatMenu.canToggle(3, [3]))
        #expect(RepeatMenu.canToggle(3, [3, 5]))
    }

    @Test func aFirstToggleMakesAWeeklyRepeatOnThatDayAndMovesTheDate() {
        let next = RepeatMenu.toggling(5, nil, anchor: wednesday)
        #expect(next == Recurrence(interval: 1, unit: .week, days: [5]))
        let set = RepeatMenu.set(next, opened: wednesday, due: wednesday)
        #expect(set.recurrence == Recurrence(interval: 1, unit: .week))
        #expect(set.due == Due(date: "2026-10-16", time: "09:00"))
        #expect(RepeatMenu.isSelected(Recurrence(interval: 1, unit: .week), set.recurrence))
    }

    @Test func toggleOrderNeverChangesTheResult() {
        let opened = wednesday
        let a = RepeatMenu.toggling(1, RepeatMenu.toggling(5, nil, anchor: opened), anchor: opened)
        let b = RepeatMenu.toggling(5, RepeatMenu.toggling(1, nil, anchor: opened), anchor: opened)
        #expect(RepeatMenu.set(a, opened: opened, due: opened) == RepeatMenu.set(b, opened: opened, due: opened))
        #expect(RepeatMenu.set(a, opened: opened, due: opened).due?.date == "2026-10-16")
    }

    @Test func aCustomWeeklyIntervalKeepsTheSetAndAWeekdaySetMatchesNoPreset() {
        let set = Recurrence(interval: 1, unit: .week, days: [2, 4])
        #expect(RepeatMenu.custom(2, .week, set) == Recurrence(interval: 2, unit: .week, days: [2, 4]))
        #expect(RepeatMenu.custom(3, .day, set) == Recurrence(interval: 3, unit: .day))
        #expect(RepeatMenu.toggling(1, Recurrence(interval: 2, unit: .week, days: [2, 4]), anchor: wednesday).interval == 2)
        #expect(!RepeatMenu.presets.contains { RepeatMenu.isSelected($0, set) })
        #expect(RepeatMenu.presets.map { Format.formatRecurrence($0, wednesday) }
            == ["Every day", "Every weekday", "Every Wed", "Every month", "Every year"])
    }
}

@Suite struct ReminderMenuTests {
    @Test func remindersAddOnceAndCustomOnesDefaultToTheDueDate() {
        #expect(ReminderMenu.adding(.before(minutes: 10), to: [.before(minutes: 10)]) == nil)
        #expect(ReminderMenu.adding(.before(minutes: 30), to: [.before(minutes: 10)]) == [.before(minutes: 10), .before(minutes: 30)])
        let due = Due(date: "2026-10-16", time: nil)
        #expect(ReminderMenu.at(date: nil, time: "08:00", due: due, today: "2026-10-14") == .at(date: "2026-10-16", time: "08:00"))
        #expect(ReminderMenu.at(date: nil, time: "08:00", due: nil, today: "2026-10-14") == .at(date: "2026-10-14", time: "08:00"))
        #expect(ReminderMenu.chipLabel(0) == "Add reminder")
        #expect(ReminderMenu.chipLabel(1) == "1 reminder")
        #expect(ReminderMenu.chipLabel(2) == "2 reminders")
        #expect(ReminderMenu.sectionTitle(due) == "Before due time · needs a time")
    }
}
