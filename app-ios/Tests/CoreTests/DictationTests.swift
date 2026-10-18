import Core
import Foundation
import Testing

@MainActor @Suite struct DictationTests {
    @Test func offlineIsNativeEvenWhenElevenLabsIsSelected() {
        let capture = Dictation.voiceCapture(.elevenlabs, online: false, nativeSpeech: true)
        #expect(capture.engine == .native)
        #expect(capture.capture == .speech)
    }

    @Test func aMissingRecognizerTypesInsteadOfCallingElevenLabs() {
        let capture = Dictation.voiceCapture(.native, online: true, nativeSpeech: false)
        #expect(capture == VoiceCapture(engine: .native, capture: .typed))
    }

    @Test func setDictationPatchesOnlyTheChoice() {
        let (store, written) = recordingStore()
        store.setDictation(.elevenlabs)
        #expect(store.dictation == .elevenlabs)
        #expect(written.writes == [patch(.settings, "settings", ["dictation": .string("elevenlabs")])])
    }

    @Test func aReloadAdoptsTheOtherDevicesChoice() {
        let (store, _) = recordingStore()
        var rows = StoredRows()
        rows.settings = [Owned(owner: "me", value: API.Settings(timeZone: "UTC", dictation: .elevenlabs))]
        store.reload(Spaces(rows, me: "me"))
        #expect(store.dictation == .elevenlabs)
    }

    @Test func aUserWithoutSettingsRowsDictatesNatively() {
        let (store, _) = recordingStore()
        #expect(store.dictation == .native)
    }
}
