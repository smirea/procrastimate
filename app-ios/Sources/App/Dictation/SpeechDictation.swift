import AVFoundation
import Core
import Foundation
import Network
import Speech

extension DictationChoice {
    var label: String {
        switch self {
        case .native: "Native"
        case .elevenlabs: "ElevenLabs"
        }
    }
}

/// Whether the device can reach the network. Used when a voice session starts, not as a status in Settings.
enum NetworkPath {
    static func online() async -> Bool {
        await withCheckedContinuation { continuation in
            let monitor = NWPathMonitor()
            let once = Once()
            monitor.pathUpdateHandler = { path in
                once.run {
                    monitor.cancel()
                    continuation.resume(returning: path.status == .satisfied)
                }
            }
            monitor.start(queue: DispatchQueue(label: "procrastimate.network"))
        }
    }
}

/// A one-shot gate, so a path monitor cannot resume its continuation twice.
private final class Once: @unchecked Sendable {
    private let lock = NSLock()
    private var ran = false

    func run(_ body: () -> Void) {
        lock.lock()
        let first = !ran
        ran = true
        lock.unlock()
        if first { body() }
    }
}

/// Apple's speech recognizer. On-device when the session is offline. Permission is asked here, when dictation
/// starts, and a denial is not asked again.
@MainActor
final class SpeechDictation {
    struct Update: Sendable {
        var text: String
        var isFinal: Bool
    }

    enum Failure: Error {
        case unsupported
        case denied
    }

    private var engine: AVAudioEngine?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?

    func start(onDevice: Bool, onUpdate: @escaping @Sendable (Update) -> Void) async throws {
        guard await Self.speechAllowed() else { throw Failure.denied }
        guard await Self.microphoneAllowed() else { throw Failure.denied }
        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US")), recognizer.isAvailable else {
            throw Failure.unsupported
        }
        if onDevice, !recognizer.supportsOnDeviceRecognition { throw Failure.unsupported }

        let recognition = SFSpeechAudioBufferRecognitionRequest()
        recognition.shouldReportPartialResults = true
        recognition.addsPunctuation = true
        recognition.requiresOnDeviceRecognition = onDevice
        request = recognition

        let audio = AVAudioEngine()
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.record, mode: .measurement, options: [.duckOthers])
            try session.setActive(true, options: .notifyOthersOnDeactivation)
            let input = audio.inputNode
            let format = input.outputFormat(forBus: 0)
            guard format.sampleRate > 0, format.channelCount > 0 else { throw Failure.unsupported }
            input.installTap(onBus: 0, bufferSize: 1024, format: format, block: Self.feed(recognition))
            audio.prepare()
            try audio.start()
        } catch {
            audio.stop()
            try? session.setActive(false, options: .notifyOthersOnDeactivation)
            throw error
        }
        engine = audio

        task = recognizer.recognitionTask(with: recognition, resultHandler: Self.results(onUpdate))
    }

    // AVAudioEngine and Speech call these back on their own threads. A closure written inside this main-actor class
    // inherits its isolation, and Swift 6 traps when it runs off the main thread, so they are built outside it.
    nonisolated private static func feed(_ request: SFSpeechAudioBufferRecognitionRequest) -> AVAudioNodeTapBlock {
        { buffer, _ in request.append(buffer) }
    }

    nonisolated private static func results(
        _ onUpdate: @escaping @Sendable (Update) -> Void
    ) -> @Sendable (SFSpeechRecognitionResult?, (any Error)?) -> Void {
        { result, _ in
            guard let result else { return }
            let update = Update(text: result.bestTranscription.formattedString, isFinal: result.isFinal)
            Task { @MainActor in onUpdate(update) }
        }
    }

    func stop() {
        task?.finish()
        task = nil
        request?.endAudio()
        request = nil
        engine?.inputNode.removeTap(onBus: 0)
        engine?.stop()
        engine = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    nonisolated private static func speechAllowed() async -> Bool {
        let status = SFSpeechRecognizer.authorizationStatus()
        switch status {
        case .authorized: return true
        case .denied, .restricted: return false
        case .notDetermined:
            return await withCheckedContinuation { continuation in
                SFSpeechRecognizer.requestAuthorization { next in
                    continuation.resume(returning: next == .authorized)
                }
            }
        @unknown default: return false
        }
    }

    private static func microphoneAllowed() async -> Bool {
        switch AVAudioApplication.shared.recordPermission {
        case .granted: return true
        case .denied: return false
        case .undetermined: return await AVAudioApplication.requestRecordPermission()
        @unknown default: return false
        }
    }
}

/// The voice session Ramble and any other speech input start. Native text is the transcript the Ramble grammar
/// parses. ElevenLabs stays the socket, and only when that option is selected and the device is online.
@MainActor
final class VoiceInput {
    private let speech = SpeechDictation()
    private let onTranscript: @Sendable (String) -> Void

    init(onTranscript: @escaping @Sendable (String) -> Void) {
        self.onTranscript = onTranscript
    }

    func start(choice: DictationChoice) async {
        let online = await NetworkPath.online()
        let plan = Dictation.voiceCapture(choice, online: online, nativeSpeech: true)
        switch plan.capture {
        case .speech:
            let deliver = onTranscript
            try? await speech.start(onDevice: !online) { update in deliver(update.text) }
        case .socket, .typed:
            break
        }
    }

    func stop() { speech.stop() }
}
