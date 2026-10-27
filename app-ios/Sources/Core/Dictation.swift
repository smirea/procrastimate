import Foundation

public typealias DictationChoice = API.DictationChoice
public typealias RambleMode = API.RambleMode
public typealias VoiceCapture = API.VoiceCapture

public enum Dictation {
    /// The Ramble socket, through ElevenLabs or Gemini Live, only when one is selected and the device is online.
    /// Otherwise native: `speech` when the platform can start a recognizer, and `typed` when it cannot. `typed` keeps
    /// the transcript editable.
    public static func voiceCapture(_ choice: DictationChoice, online: Bool, nativeSpeech: Bool) -> VoiceCapture {
        if online {
            switch choice {
            case .elevenlabs: return VoiceCapture(engine: .elevenlabs, capture: .socket)
            case .gemini: return VoiceCapture(engine: .gemini, capture: .socket)
            case .native: break
            }
        }
        return VoiceCapture(engine: .native, capture: nativeSpeech ? .speech : .typed)
    }
}
