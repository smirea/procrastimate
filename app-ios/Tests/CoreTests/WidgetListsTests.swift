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

    @Test func choicesStartWithTodayThenEveryOwnList() {
        let names = WidgetLists.choices(data, today: today, in: zone).map(\.name)
        #expect(names == ["Today", "Inbox", "Tomorrow", "This week", "No date", "House", "calls"])
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

    @Test func theFileKeepsOpenTasksAndTodaysCompletionsOnly() {
        let made = WidgetData.make(
            signedIn: true,
            tasks: data.tasks,
            projects: [house],
            labels: [calls],
            accent: "teal",
            checked: [WidgetData.Checked(task: task("Gone"), at: pinned.addingTimeInterval(-15))],
            now: pinned,
            today: today,
            in: zone
        )
        #expect(!made.tasks.map(\.title).contains("Old chore"))
        #expect(made.tasks.map(\.title).contains("Water plants"))
        #expect(made.tasks.count == 7)
        #expect(made.checked == nil)
    }

    /// A row checked off moments ago: Fix sink is done in the store, so the file holds it completed, plus the open copy
    /// the widget drew.
    func checkedOff(at: Date = pinned) -> WidgetData {
        var checked = data
        let index = checked.tasks.firstIndex { $0.title == "Fix sink" }!
        let drawn = checked.tasks[index]
        checked.tasks[index].completedAt = thisMorning
        checked.checked = [WidgetData.Checked(task: drawn, at: at)]
        return checked
    }

    @Test func aCheckedRowShowsStruckInPlaceOnlyInTheFirstEntry() throws {
        let checked = checkedOff()
        let choice = try #require(WidgetLists.choice(key: "today", in: checked, today: today, in: zone))

        let struck = WidgetLists.listing(choice, checked, now: pinned.addingTimeInterval(5), showsChecked: true, today: today, in: zone)
        #expect(struck.rows.map(\.title) == ["Pay rent", "Fix sink", "Call mom"])
        #expect(struck.checked == ["Fix sink"])
        #expect(struck.tasks.map(\.title) == ["Pay rent", "Call mom"])
        #expect(struck.done == 2)

        let gone = WidgetLists.listing(choice, checked, now: pinned.addingTimeInterval(6.5), today: today, in: zone)
        #expect(gone.rows.map(\.title) == ["Pay rent", "Call mom"])
        #expect(gone.checked.isEmpty)

        let stale = WidgetLists.listing(choice, checked, now: pinned.addingTimeInterval(15), showsChecked: true, today: today, in: zone)
        #expect(stale.checked.isEmpty)
    }

    @Test func aCheckedRepeatingTaskHidesItsNextOccurrenceUntilItLeaves() throws {
        var checked = data
        let index = checked.tasks.firstIndex { $0.title == "Call mom" }!
        let drawn = checked.tasks[index]
        checked.tasks[index].due = Due(date: today)
        checked.checked = [WidgetData.Checked(task: drawn, at: pinned)]
        let choice = try #require(WidgetLists.choice(key: "today", in: checked, today: today, in: zone))

        let struck = WidgetLists.listing(choice, checked, now: pinned, showsChecked: true, today: today, in: zone)
        #expect(struck.rows.map(\.title) == ["Pay rent", "Fix sink", "Call mom"])
        #expect(struck.tasks.map(\.title) == ["Pay rent", "Fix sink"])
        let after = WidgetLists.listing(choice, checked, now: pinned.addingTimeInterval(1.5), today: today, in: zone)
        #expect(after.rows.map(\.title) == ["Pay rent", "Fix sink", "Call mom"])
        #expect(after.checked.isEmpty)
    }

    @Test func aCheckedOverdueRowNoLongerCountsAsOverdue() throws {
        var checked = data
        let index = checked.tasks.firstIndex { $0.title == "Pay rent" }!
        checked.checked = [WidgetData.Checked(task: checked.tasks[index], at: pinned)]
        checked.tasks[index].completedAt = thisMorning
        let choice = try #require(WidgetLists.choice(key: "inbox", in: checked, today: today, in: zone))
        let listing = WidgetLists.listing(choice, checked, now: pinned, showsChecked: true, today: today, in: zone)
        #expect(listing.overdue == 0)
        #expect(listing.rows.first?.title == "Pay rent")
    }

    @Test func checkedRowsLeaveAMomentAfterTheRedrawThatShowsThem() {
        let redraw = pinned.addingTimeInterval(4)
        let redraws = WidgetLists.redraws(after: redraw, checkedOff(), days: 2, in: zone)
        #expect(redraws.map(\.timeIntervalSince1970) == [redraw.timeIntervalSince1970 + 1.5, 1_792_022_400, 1_792_108_800])
        let later = WidgetLists.redraws(after: pinned.addingTimeInterval(20), checkedOff(), days: 2, in: zone)
        #expect(later.map(\.timeIntervalSince1970) == [1_792_022_400, 1_792_108_800])
    }

    @Test func titlesShowALinksLabelOnly() {
        #expect(WidgetLists.title("Look into [Google Maps](https://maps.google.com/x)") == "Look into Google Maps")
        #expect(WidgetLists.title("Read https://example.com/a now") == "Read https://example.com/a now")
        #expect(WidgetLists.title("Buy oat milk") == "Buy oat milk")
    }

    @Test func dueDatesDropTodayOrTheTime() {
        #expect(WidgetLists.due(Due(date: today, time: "15:00"), today) == "3pm")
        #expect(WidgetLists.due(Due(date: today, time: "09:30"), today) == "9:30am")
        #expect(WidgetLists.due(Due(date: today), today) == "Today")
        #expect(WidgetLists.due(Due(date: "2026-10-13", time: "15:00"), today) == "Yest.")
        #expect(WidgetLists.due(Due(date: "2026-10-15", time: "15:00"), today) == "Tmrw")
        #expect(WidgetLists.due(Due(date: "2026-10-17"), today) == "Sat")
        #expect(WidgetLists.due(Due(date: "2026-10-01"), today) == "Oct 1")
        #expect(WidgetLists.due(Due(date: "2027-01-05"), today) == "Jan 5, 2027")
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
    }
}
