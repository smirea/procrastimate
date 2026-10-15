import Core
import Foundation
import Testing

@Suite struct DictationTests {
    @Test func offlineIsNativeEvenWhenElevenLabsIsSelected() {
        let capture = Dictation.voiceCapture(.elevenlabs, online: false, nativeSpeech: true)
        #expect(capture.engine == .native)
        #expect(capture.capture == .speech)
    }

    @Test func aMissingRecognizerTypesInsteadOfCallingElevenLabs() {
        let capture = Dictation.voiceCapture(.native, online: true, nativeSpeech: false)
        #expect(capture == VoiceCapture(engine: .native, capture: .typed))
    }

    @Test func setDictationQueuesOneSettingsOp() {
        var snapshot = Snapshot.empty(now: 0)
        SyncEngine.ensure(&snapshot, deviceId: "device", now: 0, timeZone: "UTC") { "op-1" }
        SyncEngine.setDictation(&snapshot, .elevenlabs, now: 1) { "op-2" }
        let op = snapshot.sync?.outbox.last
        #expect(op?.kind == .settings)
        #expect(op?.id == "settings")
        #expect(op?.fields["dictation"] == .string("elevenlabs"))
        #expect(op?.fields["timeZone"] == nil)
        #expect(snapshot.sync?.dictation == .elevenlabs)
    }

    @Test func aSyncChangeAdoptsTheOtherDevicesChoice() {
        var snapshot = Snapshot.empty(now: 0)
        SyncEngine.ensure(&snapshot, deviceId: "device", now: 0, timeZone: "UTC") { "op-1" }
        let body = Data(
            #"{"acked":["op-1"],"cursor":1,"hlc":"2:0:server","epoch":0,"changes":[{"seq":1,"opId":"op-2","kind":"settings","id":"settings","fields":{"dictation":"elevenlabs"}}]}"#
                .utf8
        )
        #expect(SyncEngine.apply(&snapshot, response: body, now: 3) { "op-3" })
        #expect(snapshot.sync?.dictation == .elevenlabs)
        #expect(snapshot.sync?.timeZone == "UTC")
    }

    @Test func aDocumentFromBeforeDictationDefaultsToNative() throws {
        let json = Data(
            #"{"tasks":[],"projects":[],"labels":[],"remindersCheckedAt":1,"sync":{"deviceId":"d","cursor":0,"outbox":[],"clock":"0:0:d","timeZone":"UTC","epoch":0,"reset":false}}"#
                .utf8
        )
        let loaded = Snapshot.load(json, now: 1)
        #expect(try #require(loaded.sync).dictation == .native)
    }
}
