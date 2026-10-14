import Foundation

public typealias DictationChoice = API.DictationChoice
public typealias VoiceCapture = API.VoiceCapture

public enum Dictation {
    /// ElevenLabs only when it is selected and the device is online. Otherwise native: `speech` when the
    /// platform can start a recognizer, and `typed` when it cannot. `typed` keeps the transcript editable.
    public static func voiceCapture(_ choice: DictationChoice, online: Bool, nativeSpeech: Bool) -> VoiceCapture {
        if choice == .elevenlabs, online {
            return VoiceCapture(engine: .elevenlabs, capture: .socket)
        }
        return VoiceCapture(engine: .native, capture: nativeSpeech ? .speech : .typed)
    }
}
