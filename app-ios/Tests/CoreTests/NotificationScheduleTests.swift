import Core
import Foundation
import Testing

@MainActor @Suite struct NotificationScheduleTests {
    let utc = TimeZone(identifier: "UTC")!

    func task(_ id: String, _ due: Due?, reminders: [Reminder] = [], completedAt: Int? = nil) -> TaskItem {
        TaskItem(id: id, title: id, due: due, reminders: reminders, createdAt: 0, completedAt: completedAt)
    }

    func minutes(_ n: Double) -> Int { pinned.addingTimeInterval(n * 60).epochMilliseconds }

    func pending(_ item: Notifications.Scheduled) -> Notifications.Pending {
        Notifications.Pending(id: item.tag, title: item.title, body: item.body, opens: item.opens)
    }

    @Test func aChangeAddsWhatIsMissingOrChangedAndRemovesStaleMoments() {
        let due = Due(date: "2026-10-14", time: "10:30")
        let schedule = Notifications.upcomingNotifications(
            [task("call", due, reminders: [.before(minutes: 20)]), task("gym", Due(date: "2026-10-14", time: "18:00"))],
            now: pinned,
            limit: 60,
            in: utc
        )
        #expect(schedule.map(\.tag) == ["at:\(minutes(10))", "at:\(minutes(30))", "at:\(minutes(480))"])
        #expect(schedule.map(\.body) == ["Today 10:30 AM", "Today 10:30 AM", "Today 6:00 PM"])

        let held = [
            pending(schedule[0]),
            Notifications.Pending(id: "at:\(minutes(30))", title: "old title", body: "Today 10:30 AM", opens: schedule[1].opens),
            Notifications.Pending(id: "done:\(minutes(5))", title: "done", body: "Today 10:05 AM", opens: nil),
            Notifications.Pending(id: "test", title: "Notifications are on", body: "", opens: nil),
        ]
        let change = Notifications.scheduleChange(schedule, pending: held)
        #expect(change.add.map(\.tag) == ["at:\(minutes(30))", "at:\(minutes(480))"])
        #expect(change.remove == ["done:\(minutes(5))"])
        #expect(Notifications.scheduleChange(schedule, pending: schedule.map(pending)) == Notifications.ScheduleChange())
    }

    @Test func aMomentWhoseTargetChangedIsScheduledAgain() {
        let schedule = Notifications.upcomingNotifications(
            [task("call", Due(date: "2026-10-14", time: "10:30"))], now: pinned, limit: 60, in: utc
        )
        let moved = Notifications.Pending(id: schedule[0].tag, title: "call", body: "Today 10:30 AM", opens: .init(kind: .task, id: "old"))
        #expect(Notifications.scheduleChange(schedule, pending: [moved]).add.map(\.tag) == ["at:\(minutes(30))"])
    }

    @Test func arrivingWithSeveralTasksShowsOneNotificationThatOpensThePlace() {
        let austin = TaskLocation(name: "Austin", latitude: 30.2672, longitude: -97.7431, radius: 2000, trigger: .arrive)
        let tasks = ["Gun courses", "Yoga maybe", "Give timeleft another shot", "Setup arcade"].map {
            TaskItem(id: $0, title: $0, location: austin, createdAt: 0)
        }
        let group = Notifications.placeNotification(tasks, austin, at: pinned)
        #expect(group.title == "4 tasks at Austin")
        #expect(group.body == "Gun courses, Yoga maybe, Give timeleft another shot, and 1 more")
        #expect(group.opens == .init(kind: .place, id: "30.2672,-97.7431"))

        var leaving = austin
        leaving.trigger = .leave
        #expect(Notifications.placeNotification(Array(tasks.prefix(2)), leaving, at: pinned).title == "2 tasks leaving Austin")

        let one = Notifications.placeNotification([tasks[0]], austin, at: pinned)
        #expect([one.title, one.body] == ["Gun courses", "Arriving at Austin"])
        #expect(one.opens == .init(kind: .task, id: "Gun courses"))
    }

    @Test func momentTagsAreAPrefixAndAnEpoch() {
        #expect(Notifications.isMomentTag("at:1791972000000"))
        #expect(Notifications.isMomentTag("3f2a:1791972000000"))
        #expect(Notifications.isMomentTag("a:b:1"))
        #expect(!Notifications.isMomentTag("test"))
        #expect(!Notifications.isMomentTag(":1"))
        #expect(!Notifications.isMomentTag("task:soon"))
    }

}
