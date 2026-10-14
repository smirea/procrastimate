import Core
import Foundation
import Testing

@MainActor @Suite struct NotificationScheduleTests {
    let utc = TimeZone(identifier: "UTC")!

    func task(_ id: String, _ due: Due?, reminders: [Reminder] = [], completedAt: Int? = nil) -> TaskItem {
        TaskItem(id: id, title: id, due: due, reminders: reminders, createdAt: 0, completedAt: completedAt)
    }

    func minutes(_ n: Double) -> Int { pinned.addingTimeInterval(n * 60).epochMilliseconds }

    @Test func theWindowKeepsTheSoonestSixty() {
        let tasks = (0..<70).map { i in
            task("t\(i)", Due(date: "2026-10-15", time: String(format: "%02d:%02d", i / 60, i % 60)))
        }
        let schedule = Notifications.upcomingNotifications(tasks, now: pinned, limit: Notifications.maxScheduled, in: utc)
        #expect(schedule.count == 60)
        #expect(schedule.first?.taskId == "t0")
        #expect(schedule.last?.taskId == "t59")
    }

    @Test func aChangeAddsWhatIsMissingOrChangedAndRemovesStaleTaskMoments() {
        let due = Due(date: "2026-10-14", time: "10:30")
        let schedule = Notifications.upcomingNotifications(
            [task("call", due, reminders: [.before(minutes: 20)]), task("gym", Due(date: "2026-10-14", time: "18:00"))],
            now: pinned,
            limit: 60,
            in: utc
        )
        #expect(schedule.map(\.tag) == ["call:\(minutes(10))", "call:\(minutes(30))", "gym:\(minutes(480))"])
        #expect(schedule.map(\.body) == ["Due at 10:30 AM", "Due now", "Due now"])

        let pending = [
            Notifications.Pending(id: "call:\(minutes(10))", title: "call", body: "Due at 10:30 AM"),
            Notifications.Pending(id: "call:\(minutes(30))", title: "old title", body: "Due now"),
            Notifications.Pending(id: "done:\(minutes(5))", title: "done", body: "Due now"),
            Notifications.Pending(id: "test", title: "Notifications are on", body: ""),
        ]
        let change = Notifications.scheduleChange(schedule, pending: pending)
        #expect(change.add.map(\.tag) == ["call:\(minutes(30))", "gym:\(minutes(480))"])
        #expect(change.remove == ["done:\(minutes(5))"])
        #expect(Notifications.scheduleChange(schedule, pending: schedule.map {
            Notifications.Pending(id: $0.tag, title: $0.title, body: $0.body)
        }) == Notifications.ScheduleChange())
    }

    @Test func taskTagsAreATaskIdAndAnEpoch() {
        #expect(Notifications.isTaskTag("3f2a:1791972000000"))
        #expect(Notifications.isTaskTag("a:b:1"))
        #expect(!Notifications.isTaskTag("test"))
        #expect(!Notifications.isTaskTag(":1"))
        #expect(!Notifications.isTaskTag("task:soon"))
    }

    @Test func dueRemindersAreTheMomentsSinceTheLastCheck() {
        let tasks = [
            task("Call mom", Due(date: "2026-10-14", time: "10:30")),
            task("Taxes", Due(date: "2026-10-14", time: nil)),
            task("Standup", Due(date: "2026-10-14", time: "10:45"), reminders: [.at(date: "2026-10-14", time: "10:45")]),
            task("Gym", Due(date: "2026-10-14", time: "11:00"), reminders: [.before(minutes: 30)]),
            task("Done", Due(date: "2026-10-14", time: "10:15"), completedAt: 1),
        ]
        let titles = { (since: Double, now: Double) in
            Notifications.dueReminders(tasks, since: minutes(since), now: minutes(now), in: utc).map(\.title)
        }
        #expect(titles(0, 31) == ["Call mom", "Gym"])
        #expect(titles(31, 46) == ["Standup"])
        #expect(titles(46, 61) == ["Gym"])
        #expect(titles(61, 600) == [])
    }

    @Test func dueRemindersFollowEventsAndSkipDueTimesAtAPlace() {
        var meetup = task("Talk to Jan", nil)
        meetup.event = TaskEvent(
            id: "meetup", title: "Walking meetup", allDay: false, series: false, edge: .before, minutes: 15,
            occurrences: [EventOccurrence(start: minutes(30), end: minutes(90), original: minutes(30))]
        )
        var milk = task("Buy milk", Due(date: "2026-10-14", time: "10:30"))
        milk.location = TaskLocation(name: "Rewe", address: nil, latitude: 52.5, longitude: 13.4, radius: 150, trigger: .arrive)
        let titles = Notifications.dueReminders([meetup, milk], since: minutes(0), now: minutes(31), in: utc).map(\.title)
        #expect(titles == ["Talk to Jan"])
    }

    @Test func importingTheSameBackupTwiceAddsNothing() {
        var next = 0
        let store = Store(file: nil, clock: AppClock.fixed(pinned, timeZone: utc), newId: {
            next += 1
            return "id-\(next)"
        })
        let files = [Todoist.BackupFile(
            name: "Home [123].csv",
            text: "\u{FEFF}TYPE,CONTENT,PRIORITY,INDENT\r\ntask,Water plants @home,1,1\r\ntask,Repot fern,4,2\r\n"
        )]
        let backup = Todoist.readTodoistBackup(files, pinned, in: utc)
        let first = store.importTodoist(backup)
        #expect([first.projects, first.labels, first.tasks, first.skipped] == [1, 1, 2, 0] as [Int])
        #expect(store.tasks.map(\.title) == ["Water plants", "Repot fern"])
        #expect(store.tasks[1].parentId == store.tasks[0].id)
        let second = store.importTodoist(backup)
        #expect([second.projects, second.labels, second.tasks, second.skipped] == [0, 0, 0, 2] as [Int])
        #expect(store.tasks.count == 2)
    }
}
