import Core
import Foundation
import Testing

@Suite struct IntentRulesTests {
    let zone = TimeZone(identifier: "UTC")!
    let house = Project(id: "p-house", name: "House", createdAt: 1)
    let calls = Label(id: "l-calls", name: "calls", createdAt: 1)
    let errands = Label(id: "l-errands", name: "Errands", createdAt: 2)
    let gym = Label(
        id: "l-gym",
        name: "Gym",
        place: SavedPlace(address: "Ring 2", latitude: 52.5, longitude: 13.4, radius: 200),
        createdAt: 3
    )
    let gymLocation = TaskLocation(name: "Gym", address: "Ring 2", latitude: 52.5, longitude: 13.4, radius: 200, trigger: .arrive)

    func task(
        _ title: String,
        id: String = "t",
        createdAt: Int = 1,
        completedAt: Int? = nil,
        due: Due? = nil
    ) -> TaskItem {
        TaskItem(id: id, title: title, due: due, createdAt: createdAt, completedAt: completedAt)
    }

    func added(_ request: IntentRules.AddRequest) -> NewTask? {
        IntentRules.newTask(request, projects: [house], labels: [calls, errands, gym], now: pinned, zone: zone)
    }

    @Test func aSpokenTitleUsesTheQuickAddGrammar() throws {
        let task = try #require(
            added(.init(text: "Call mom tomorrow 5pm p1 remind me 30m before #House @calls"))
        )
        #expect(task.title == "Call mom")
        #expect(task.due == Due(date: "2026-10-15", time: "17:00"))
        #expect(task.priority == .p1)
        #expect(task.reminders == [.before(minutes: 30)])
        #expect(task.projectId == "p-house")
        #expect(task.labelIds == ["l-calls"])
    }

    @Test func anExplicitValueFillsWhatTheTitleLeftUnset() throws {
        let task = try #require(
            added(.init(
                text: "Submit report",
                projectId: "p-house",
                labelIds: ["l-calls"],
                priority: .p2,
                due: Due(date: "2026-10-20", time: "09:00"),
                reminders: [.before(minutes: 10)]
            ))
        )
        #expect(task.title == "Submit report")
        #expect(task.projectId == "p-house")
        #expect(task.labelIds == ["l-calls"])
        #expect(task.priority == .p2)
        #expect(task.due == Due(date: "2026-10-20", time: "09:00"))
        #expect(task.reminders == [.before(minutes: 10)])
    }

    @Test func theTitleWinsOverAnExplicitValueForTheSameField() throws {
        let task = try #require(
            added(.init(
                text: "Submit report tomorrow p1 #House @calls",
                projectId: "p-other",
                labelIds: ["l-errands"],
                priority: .p3,
                due: Due(date: "2026-10-20", time: nil),
                reminders: [.before(minutes: 5)]
            ))
        )
        #expect(task.due == Due(date: "2026-10-15", time: nil))
        #expect(task.priority == .p1)
        #expect(task.projectId == "p-house")
        #expect(task.labelIds == ["l-errands", "l-calls"])
        #expect(task.reminders == [.before(minutes: 5)])
    }

    @Test func aSavedPlacePickedAsALabelBecomesTheTasksPlace() throws {
        let task = try #require(added(.init(text: "Stretch", labelIds: ["l-calls", "l-gym"])))
        #expect(task.labelIds == ["l-calls"])
        #expect(task.location == gymLocation)
    }

    @Test func aSavedPlaceInTheTitleBecomesTheTasksPlace() throws {
        let task = try #require(added(.init(text: "Stretch @Gym", labelIds: ["l-calls"])))
        #expect(task.title == "Stretch")
        #expect(task.labelIds == ["l-calls"])
        #expect(task.location == gymLocation)
    }

    @Test func aSpokenReminderReplacesTheShortcutReminder() throws {
        let task = try #require(
            added(.init(
                text: "Call mom tomorrow 5pm remind me 30m before",
                reminders: [.at(date: "2026-10-15", time: "16:45")]
            ))
        )
        #expect(task.reminders == [.before(minutes: 30)])
    }

    @Test func aTimeWithNoDayUsesTheExplicitDate() throws {
        let task = try #require(
            added(.init(text: "Submit report 5pm", due: Due(date: "2026-10-20", time: nil)))
        )
        #expect(task.title == "Submit report")
        #expect(task.due == Due(date: "2026-10-20", time: "17:00"))
    }

    @Test func aPhraseWithNoTitleSavesNothing() {
        #expect(added(.init(text: "tomorrow")) == nil)
        #expect(added(.init(text: "   ")) == nil)
    }

    @Test func aShortcutsDateKeepsItsClockTimeInTheZone() {
        let date = Date(timeIntervalSince1970: 1_791_997_200)
        #expect(IntentRules.due(from: date, in: zone) == Due(date: "2026-10-14", time: "17:00"))
        let york = TimeZone(identifier: "America/New_York")!
        #expect(IntentRules.due(from: date, in: york) == Due(date: "2026-10-14", time: "13:00"))
        #expect(IntentRules.reminder(at: date, in: zone) == .at(date: "2026-10-14", time: "17:00"))
    }

    @Test func aTitleMatchPrefersTheNewestOpenTaskAndIgnoresCase() {
        let tasks = [
            task("Buy milk", id: "old", createdAt: 1),
            task("buy milk", id: "new", createdAt: 5),
            task("Buy milk", id: "done", createdAt: 9, completedAt: 10),
            task("Café", id: "cafe", createdAt: 2),
        ]
        #expect(IntentRules.titleMatches(tasks, "Buy milk").map(\.id) == ["new", "old", "done"])
        #expect(IntentRules.titleMatches(tasks, "cafe").map(\.id) == ["cafe"])
        #expect(IntentRules.prefixMatches(tasks, "buy").map(\.id) == ["new", "old", "done"])
        #expect(IntentRules.prefixMatches(tasks, "Buy milk").isEmpty)
    }

    @Test func completeAndReopenHonorTheChosenStateThenTheOtherMatch() {
        let open = task("Buy milk", id: "open", createdAt: 2)
        let older = task("Buy milk", id: "older", createdAt: 1)
        let done = task("Buy milk", id: "done", createdAt: 3, completedAt: 4)
        let tasks = [open, older, done]

        #expect(IntentRules.completionTarget(.complete, id: "open", title: "Buy milk", in: tasks)?.id == "open")
        #expect(IntentRules.completionTarget(.complete, id: "done", title: "Buy milk", in: tasks)?.id == "open")
        #expect(IntentRules.completionTarget(.reopen, id: "done", title: "Buy milk", in: tasks)?.id == "done")
        #expect(IntentRules.completionTarget(.reopen, id: "open", title: "Buy milk", in: tasks)?.id == "done")
        #expect(IntentRules.completionTarget(.complete, id: "done", title: "Buy milk", in: [done]) == nil)
        #expect(IntentRules.completionTarget(.reopen, id: "open", title: "Buy milk", in: [open, older]) == nil)
        #expect(IntentRules.completionTarget(.complete, id: "missing", title: "Buy milk", in: tasks)?.id == "open")
    }

    @Test func spotlightIndexesOpenTasksOnly() {
        let tasks = [
            task("Buy milk", id: "open"),
            task("Pay rent", id: "done", completedAt: 2),
        ]
        #expect(IntentRules.indexedTasks(tasks).map(\.id) == ["open"])
    }

    @Test func searchReturnsOpenHitsBeforeCompletedOnes() {
        let tasks = [
            task("Buy milk", id: "open", createdAt: 1),
            task("Buy milk later", id: "done", createdAt: 2, completedAt: 3),
            task("Call mom", id: "other", createdAt: 4),
        ]
        #expect(IntentRules.searchTasks("milk", tasks, projects: [], labels: []).map(\.id) == ["open", "done"])
    }

    @Test func namesMatchExactlyThenByPrefixThenBySubstring() {
        let projects = [
            Project(id: "house", name: "House", createdAt: 1),
            Project(id: "home", name: "Home office", createdAt: 2),
            Project(id: "work", name: "Work", createdAt: 3),
        ]
        #expect(IntentRules.named(projects, "house", name: \.name)?.id == "house")
        #expect(IntentRules.rankedNames(projects, "home", name: \.name).map(\.id) == ["home"])
        #expect(IntentRules.rankedNames(projects, "off", name: \.name).map(\.id) == ["home"])
        #expect(IntentRules.rankedNames(projects, "", name: \.name).isEmpty)
    }

    @Test func suggestedTasksListOpenOnesFirst() {
        let tasks = [
            task("Old", id: "old", createdAt: 1),
            task("New", id: "new", createdAt: 3),
            task("Done", id: "done", createdAt: 2, completedAt: 4),
        ]
        #expect(IntentRules.suggestedTasks(tasks).map(\.id) == ["new", "old", "done"])
    }
}
