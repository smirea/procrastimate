import Core
import Foundation
import Testing

@Suite struct UserSwitchTests {
    @Test func replaceForNewUserDropsTasksAndKeepsTheDevice() {
        var snapshot = Snapshot.empty(now: 0)
        SyncEngine.ensure(&snapshot, deviceId: "device-1234", now: 0, timeZone: "UTC") { "op-1" }
        snapshot.tasks = [
            TaskItem(id: "task-1", title: "Leftover", priority: .p4, createdAt: 0),
        ]
        let deviceId = snapshot.sync?.deviceId
        #expect(snapshot.sync?.outbox.isEmpty == false)

        SyncEngine.replaceForNewUser(&snapshot)

        #expect(snapshot.tasks.isEmpty)
        #expect(snapshot.projects.isEmpty)
        #expect(snapshot.labels.isEmpty)
        #expect(snapshot.sync?.deviceId == deviceId)
        #expect(snapshot.sync?.cursor == 0)
        #expect(snapshot.sync?.outbox.isEmpty == true)
        #expect(snapshot.sync?.reset == false)
        #expect(snapshot.sync?.epoch == 0)
    }
}
