import Core
import Foundation
import Testing

@Suite struct WidgetListsTests {
    let zone = TimeZone(identifier: "UTC")!
    let today: DateKey = "2026-10-14"
    let house = Project(id: "p-house", name: "House", createdAt: 1)
    let calls = Label(id: "l-calls", name: "calls", createdAt: 1)
    /// 2026-10-14 08:00 UTC, earlier on the pinned day.
    let thisMorning = 1_791_964_800_000

    func task(
        _ title: String,
        due: DateKey? = nil,
        priority: Priority = .p4,
        project: String? = nil,
        labels: [String] = [],
        createdAt: Int = 1,
        completedAt: Int? = nil
    ) -> TaskItem {
        TaskItem(
            id: title,
            title: title,
            projectId: project,
            labelIds: labels,
            due: due.map { Due(date: $0) },
            priority: priority,
            createdAt: createdAt,
            completedAt: completedAt
        )
    }

    var data: WidgetData {
        WidgetData(
            signedIn: true,
            tasks: [
                task("Pay rent", due: "2026-10-12"),
                task("Call mom", due: today, labels: ["l-calls"]),
                task("Fix sink", due: today, priority: .p1, project: "p-house"),
                task("Plan trip", due: "2026-10-15"),
                task("Read book", createdAt: 1),
                task("Buy stamps", createdAt: 2),
                task("Water plants", due: today, completedAt: thisMorning),
                task("Old chore", due: "2026-10-01", completedAt: 1_000),
            ],
            projects: [house],
            labels: [calls]
        )
    }

    func listing(_ key: String) throws -> WidgetLists.Listing {
        let choice = try #require(WidgetLists.choice(key: key, in: data, today: today, in: zone))
        return WidgetLists.listing(choice, data, now: pinned, today: today, in: zone)
    }

    @Test func todayListsOverdueFirstThenTodayByPriority() throws {
        let today = try listing("today")
        #expect(today.tasks.map(\.title) == ["Pay rent", "Fix sink", "Call mom"])
        #expect(today.overdue == 1)
        #expect(today.done == 1)
        #expect(today.progress == 0.25)
    }

    @Test func datedListsFollowTheirScreens() throws {
        #expect(try listing("inbox").tasks.map(\.title) == ["Pay rent", "Fix sink", "Call mom", "Plan trip"])
        #expect(try listing("tomorrow").tasks.map(\.title) == ["Plan trip"])
        #expect(try listing("tomorrow").overdue == 0)
        #expect(try listing("noDate").tasks.map(\.title) == ["Buy stamps", "Read book"])
    }

    @Test func projectsAndLabelsCountOnlyTheirOwnDoneTasks() throws {
        let house = try listing("project:p-house")
        #expect(house.tasks.map(\.title) == ["Fix sink"])
        #expect(house.done == 0)
        #expect(try listing("label:l-calls").tasks.map(\.title) == ["Call mom"])
        #expect(try listing("inbox").done == 1)
    }

    @Test func aSavedPlaceCountsTasksDoneAtItsLocation() throws {
        let gym = Label(id: "l-gym", name: "Gym", place: SavedPlace(latitude: 52.5, longitude: 13.4, radius: 200), createdAt: 1)
        var lift = task("Lift", due: today, completedAt: thisMorning)
        lift.location = TaskLocation(name: "Gym", latitude: 52.5, longitude: 13.4, radius: 200, trigger: .arrive)
        var atGym = data
        atGym.labels.append(gym)
        atGym.tasks.append(lift)
        let choice = try #require(WidgetLists.choice(key: "label:l-gym", in: atGym, today: today, in: zone))
        #expect(WidgetLists.listing(choice, atGym, now: pinned, today: today, in: zone).done == 1)
    }

    @Test func aDeletedProjectIsNoLongerAChoice() {
        var gone = data
        gone.projects = []
        #expect(WidgetLists.choice(key: "project:p-house", in: gone, today: today, in: zone) == nil)
    }

    @Test func theFileKeepsOpenTitledTasksAndTodaysCompletionsOnly() {
        let made = WidgetData.make(
            signedIn: true,
            tasks: data.tasks + [task("", due: today)],
            projects: [house],
            labels: [calls],
            accent: "teal",
            checked: [WidgetData.Checked(task: task("Gone"), at: pinned.addingTimeInterval(-WidgetLists.checkedFor))],
            now: pinned,
            today: today,
            in: zone
        )
        #expect(!made.tasks.map(\.title).contains("Old chore"))
        #expect(made.tasks.map(\.title).contains("Water plants"))
        #expect(made.tasks.count == 7)
        #expect(made.checked == nil)
    }

    @Test func aSubtaskUnderACompletedParentLeavesEveryWidget() throws {
        var hang = task("Hang shelf", due: today)
        hang.parentId = "Move"
        var drill = task("Drill holes", due: today)
        drill.parentId = "Hang shelf"
        var parent = task("Move", completedAt: 1_000)
        let made = WidgetData.make(
            signedIn: true, tasks: data.tasks + [parent, hang], projects: [house], labels: [calls], accent: nil,
            now: pinned, today: today, in: zone
        )
        #expect(!made.tasks.map(\.title).contains("Hang shelf"))
        parent.completedAt = nil
        parent.due = Due(date: "2026-10-15")
        var moved = data
        moved.tasks += [parent, hang, drill]
        let choice = try #require(WidgetLists.choice(key: "today", in: moved, today: today, in: zone))
        #expect(WidgetLists.listing(choice, moved, now: pinned, today: today, in: zone).tasks.map(\.title)
            == ["Pay rent", "Fix sink", "Call mom", "Hang shelf"])
        let inbox = try #require(WidgetLists.choice(key: "inbox", in: moved, today: today, in: zone))
        #expect(WidgetLists.listing(inbox, moved, now: pinned, today: today, in: zone).tasks.map(\.title)
            == ["Pay rent", "Fix sink", "Call mom", "Plan trip", "Move"])
    }

    /// Fix sink checked off in a widget at `pinned`.
    func checkedOff() throws -> WidgetData {
        try #require(data.checking("Fix sink", now: pinned, today: today, in: zone))
    }

    @Test func checkingCompletesTheTaskAndKeepsItsRowAsDrawn() throws {
        let checked = try checkedOff()
        #expect(checked.tasks.first { $0.id == "Fix sink" }?.completedAt == Int(pinned.timeIntervalSince1970 * 1000))
        #expect(checked.checked == [WidgetData.Checked(task: data.tasks[2], at: pinned)])
        #expect(checked.checking("Fix sink", now: pinned, today: today, in: zone) == nil)
        #expect(data.checking("Water plants", now: pinned, today: today, in: zone) == nil)
    }

    @Test func aCheckedRepeatingTaskHidesItsNextOccurrenceUntilItLeaves() throws {
        var daily = data
        daily.tasks[0].recurrence = Recurrence(interval: 1, unit: .day)
        let checked = try #require(daily.checking("Pay rent", now: pinned, today: today, in: zone))
        let next = try #require(checked.tasks.first { $0.id == "Pay rent" })
        #expect(next.completedAt == nil)
        #expect(next.due?.date == "2026-10-15")
        let choice = try #require(WidgetLists.choice(key: "inbox", in: checked, today: today, in: zone))

        let struck = WidgetLists.listing(choice, checked, now: pinned, today: today, in: zone)
        #expect(struck.rows.map(\.title) == ["Pay rent", "Fix sink", "Call mom", "Plan trip"])
        #expect(struck.checked == ["Pay rent"])
        #expect(struck.tasks.map(\.title) == ["Fix sink", "Call mom", "Plan trip"])
        let after = WidgetLists.listing(choice, checked, now: pinned.addingTimeInterval(1.5), today: today, in: zone)
        #expect(after.rows.map(\.title) == ["Fix sink", "Call mom", "Pay rent", "Plan trip"])
        #expect(after.checked.isEmpty)
    }

    @Test func aCheckedOverdueRowNoLongerCountsAsOverdue() throws {
        let checked = try #require(data.checking("Pay rent", now: pinned, today: today, in: zone))
        let choice = try #require(WidgetLists.choice(key: "inbox", in: checked, today: today, in: zone))
        let listing = WidgetLists.listing(choice, checked, now: pinned, today: today, in: zone)
        #expect(listing.overdue == 0)
        #expect(listing.rows.first?.title == "Pay rent")
    }

    @Test func addingFromTodayDatesTheTaskToday() {
        #expect(WidgetList.today.screen(today: today) == .inbox(date: today))
        #expect(WidgetList.pin(.inbox).screen(today: today) == .inbox(date: nil))
    }

    @Test func linksRoundTrip() throws {
        let links: [AppLink] = [
            .task(id: "t-1"), .list(key: "project:p-house"), .add(list: "today"), .add(list: nil), .ramble(list: "label:l-calls"),
        ]
        for link in links {
            #expect(AppLink(link.url) == link)
        }
        #expect(AppLink(try #require(URL(string: "procrastimate://task/abc"))) == .task(id: "abc"))
        #expect(AppLink(try #require(URL(string: "https://procrastimate.stf.lol/task/abc"))) == nil)
        #expect(AppLink(try #require(URL(string: "https://procrastimate.stf.lol/inbox?task=abc"))) == .task(id: "abc"))
        #expect(AppLink(try #require(URL(string: "https://procrastimate.stf.lol/s/abc"))) == nil)
    }

    func shortcut(_ key: String, _ counter: WidgetLists.Counter, in data: WidgetData) throws -> WidgetLists.Shortcut {
        let choice = try #require(WidgetLists.choice(key: key, in: data, today: today, in: zone))
        return WidgetLists.shortcut(choice, counter: counter, data, now: pinned, today: today, in: zone)
    }

    @Test func shortcutsCountAProjectsDueOrPendingTasks() throws {
        var data = data
        data.tasks += [
            task("Paint door", due: "2026-10-13", project: "p-house"),
            task("Mow lawn", due: "2026-10-20", project: "p-house"),
            task("Clean gutters", project: "p-house"),
            task("Swept porch", due: today, project: "p-house", completedAt: thisMorning),
        ]
        var hinge = task("Oil hinge", due: today, project: "p-house")
        hinge.parentId = "Clean gutters"
        data.tasks.append(hinge)
        let due = try shortcut("project:p-house", .due, in: data)
        #expect(due.choice.name == "House")
        #expect(due.count == 3)
        #expect(due.overdue)
        #expect(try shortcut("project:p-house", .pending, in: data).count == 4)
        let none = try shortcut("project:p-house", .none, in: data)
        #expect(none.count == nil)
        #expect(!none.overdue)
    }

    @Test func shortcutsCountEveryKindOfList() throws {
        #expect(try shortcut("today", .due, in: data).count == 3)
        #expect(try shortcut("today", .pending, in: data).count == 3)
        #expect(try shortcut("inbox", .due, in: data).count == 3)
        #expect(try shortcut("inbox", .pending, in: data).count == 4)
        #expect(try shortcut("inbox", .due, in: data).overdue)
        #expect(try shortcut("tomorrow", .due, in: data).count == 0)
        #expect(try shortcut("tomorrow", .pending, in: data).count == 1)
        #expect(try shortcut("noDate", .pending, in: data).count == 2)
        let calls = try shortcut("label:l-calls", .due, in: data)
        #expect(calls.count == 1)
        #expect(!calls.overdue)
    }

    @Test func aPlacedLabelsShortcutCountsThePlacesTasks() throws {
        var data = data
        data.labels.append(Label(id: "l-gym", name: "Gym", place: SavedPlace(latitude: 52.5, longitude: 13.4, radius: 200), createdAt: 1))
        var lift = task("Lift", due: today)
        lift.location = TaskLocation(name: "Gym", latitude: 52.5, longitude: 13.4, radius: 200, trigger: .arrive)
        data.tasks.append(lift)
        #expect(try shortcut("label:l-gym", .due, in: data).count == 1)
        #expect(try shortcut("label:l-gym", .pending, in: data).count == 1)
    }
}
