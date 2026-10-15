import Core
import Foundation
import Testing

@Suite struct QuickAddButtonsTests {
    @Test func setQuickAddButtonsQueuesOneSettingsOp() {
        var snapshot = Snapshot.empty(now: 0)
        SyncEngine.ensure(&snapshot, deviceId: "device", now: 0, timeZone: "UTC") { "op-1" }
        SyncEngine.setQuickAddButtons(&snapshot, [.date, .labels], now: 1) { "op-2" }
        let op = snapshot.sync?.outbox.last
        #expect(op?.kind == .settings)
        #expect(op?.fields == ["quickAddButtons": .array([.string("date"), .string("labels")])])
        #expect(snapshot.sync?.quickAddButtons == [.date, .labels])
    }

    @Test func aSyncChangeAdoptsTheOtherDevicesButtons() {
        var snapshot = Snapshot.empty(now: 0)
        SyncEngine.ensure(&snapshot, deviceId: "device", now: 0, timeZone: "UTC") { "op-1" }
        let body = Data(
            #"{"acked":["op-1"],"cursor":1,"hlc":"2:0:server","epoch":0,"changes":[{"seq":1,"opId":"op-2","kind":"settings","id":"settings","fields":{"quickAddButtons":["repeat","event"]}}]}"#
                .utf8
        )
        #expect(SyncEngine.apply(&snapshot, response: body, now: 3) { "op-3" })
        #expect(snapshot.sync?.quickAddButtons == [.repeat, .event])
        #expect(snapshot.sync?.dictation == .native)
    }

    @Test func aFullSnapshotAdoptsTheStoredSettings() {
        var snapshot = Snapshot.empty(now: 0)
        SyncEngine.ensure(&snapshot, deviceId: "device", now: 0, timeZone: "UTC") { "op-1" }
        let body = Data(
            #"{"acked":["op-1"],"cursor":3,"hlc":"2:0:server","epoch":0,"snapshot":{"tasks":[],"projects":[],"sections":[],"labels":[],"settings":{"timeZone":"Europe/Berlin","dictation":"elevenlabs","quickAddButtons":["labels"]}}}"#
                .utf8
        )
        #expect(SyncEngine.apply(&snapshot, response: body, now: 3) { "op-3" })
        #expect(snapshot.sync?.quickAddButtons == [.labels])
        #expect(snapshot.sync?.dictation == .elevenlabs)
        // The zone stays the one this device last wrote.
        #expect(snapshot.sync?.timeZone == "UTC")
        #expect(snapshot.sync?.cursor == 3)
    }

    @Test func aDocumentFromBeforeTheSettingGetsTheDefaultRow() throws {
        let json = Data(
            #"{"tasks":[],"projects":[],"labels":[],"remindersCheckedAt":1,"sync":{"deviceId":"d","cursor":0,"outbox":[],"clock":"0:0:d","timeZone":"UTC","epoch":0,"reset":false}}"#
                .utf8
        )
        #expect(try #require(Snapshot.load(json, now: 1).sync).quickAddButtons == [.date, .priority, .reminders, .subtasks])
    }
}
