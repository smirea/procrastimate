import Core
import Foundation
import Testing

@MainActor @Suite struct NotificationScheduleTests {
    let utc = TimeZone(identifier: "UTC")!

    func task(_ id: String, _ due: Due?, reminders: [Reminder] = [], completedAt: Int? = nil) -> TaskItem {
        TaskItem(id: id, title: id, due: due, reminders: reminders, createdAt: 0, completedAt: completedAt)
    }

    func minutes(_ n: Double) -> Int { pinned.addingTimeInterval(n * 60).epochMilliseconds }

    @Test func aChangeAddsWhatIsMissingOrChangedAndRemovesStaleTaskMoments() {
        let due = Due(date: "2026-10-14", time: "10:30")
        let schedule = Notifications.upcomingNotifications(
            [task("call", due, reminders: [.before(minutes: 20)]), task("gym", Due(date: "2026-10-14", time: "18:00"))],
            now: pinned,
            limit: 60,
            in: utc
        )
        #expect(schedule.map(\.tag) == ["call:\(minutes(10))", "call:\(minutes(30))", "gym:\(minutes(480))"])
        #expect(schedule.map(\.body) == ["Today 10:30 AM", "Today 10:30 AM", "Today 6:00 PM"])

        let pending = [
            Notifications.Pending(id: "call:\(minutes(10))", title: "call", body: "Today 10:30 AM"),
            Notifications.Pending(id: "call:\(minutes(30))", title: "old title", body: "Today 10:30 AM"),
            Notifications.Pending(id: "done:\(minutes(5))", title: "done", body: "Today 10:05 AM"),
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

}
