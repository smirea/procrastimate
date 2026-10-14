import AVFoundation
import Core
import Foundation
import Synchronization

/// One Ramble capture. Native speech uses `SpeechDictation`. ElevenLabs streams 16 kHz PCM to the ramble socket.
/// Offline never opens that socket. A failure leaves the transcript editable.
@MainActor
final class RambleSession {
    enum End {
        case stopped
        case typed
        case failed(String)
    }

    var onText: (String, Int) -> Void = { _, _ in }
    var onEnd: (End) -> Void = { _ in }
    var onLevel: (Float) -> Void = { _ in }

    private let speech = SpeechDictation()
    private let pump = RamblePump()
    private var socket: URLSessionWebSocketTask?
    private var engine: AVAudioEngine?
    private var committed = ""
    private var partial = ""
    private var stopped = false
    private var userStop = false
    private var heard = false
    private var tapped = false
    private var epoch = 0

    func start(choice: DictationChoice, deviceId: String?) async {
        epoch += 1
        speech.cancel()
        haltEngine()
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
        stopped = false
        userStop = false
        heard = false
        committed = ""
        partial = ""
        #if DEBUG
        if let script = ProcessInfo.processInfo.environment["PROCRASTIMATE_RAMBLE_SCRIPT"] {
            speak(script)
            return
        }
        #endif
        let online = await NetworkPath.online()
        switch Dictation.voiceCapture(choice, online: online, nativeSpeech: true).capture {
        case .speech:
            await startSpeech()
        case .socket:
            await startSocket(deviceId: deviceId)
        case .typed:
            onEnd(.typed)
        }
    }

    #if DEBUG
    /// DEBUG-only. The simulator has no microphone, so `PROCRASTIMATE_RAMBLE_SCRIPT` arrives a word at a time like
    /// live speech, and the session keeps listening until stopped.
    private func speak(_ script: String) {
        let token = epoch
        let words = script.split(separator: " ")
        Task { @MainActor in
            for count in 1 ... max(words.count, 1) {
                try? await Task.sleep(for: .milliseconds(90))
                guard token == self.epoch, !self.userStop else { return }
                let text = words.prefix(count).joined(separator: " ")
                self.onText(text, (text as NSString).length)
            }
        }
    }
    #endif

    func stop() {
        userStop = true
        haltEngine()
        guard let socket, socket.state == .running else {
            let token = epoch
            Task { @MainActor in
                await speech.finish()
                guard token == self.epoch else { return }
                self.finish(.stopped)
            }
            return
        }
        socket.send(.string(#"{"type":"stop"}"#)) { _ in }
        let token = epoch
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(3.5))
            guard token == self.epoch else { return }
            self.finish(.stopped)
        }
    }

    private func startSpeech() async {
        do {
            try await speech.start { [weak self] text in
                self?.onText(text, (text as NSString).length)
            }
        } catch SpeechDictation.Failure.denied {
            onEnd(.failed("The microphone is off. You can type the ramble instead."))
        } catch {
            ErrorReport.log("Dictation could not start", detail: String(reflecting: error))
            onEnd(.typed)
        }
    }

    private func startSocket(deviceId: String?) async {
        guard let token = SessionToken.read() else {
            onEnd(.failed("Ramble needs a connection"))
            return
        }
        switch AVAudioApplication.shared.recordPermission {
        case .granted:
            break
        case .denied:
            onEnd(.failed("The microphone is off. You can type the ramble instead."))
            return
        case .undetermined:
            guard await AVAudioApplication.requestRecordPermission() else {
                onEnd(.failed("The microphone is off. You can type the ramble instead."))
                return
            }
        @unknown default:
            onEnd(.failed("The microphone is off. You can type the ramble instead."))
            return
        }
        var components = URLComponents(url: AppEnvironment.apiURL.appending(path: "api/ramble/socket"), resolvingAgainstBaseURL: false)
        components?.scheme = AppEnvironment.apiURL.scheme == "https" ? "wss" : "ws"
        guard let url = components?.url else {
            onEnd(.failed("Ramble needs a connection"))
            return
        }
        var request = URLRequest(url: url)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("procrastimate.ramble", forHTTPHeaderField: "Sec-WebSocket-Protocol")
        if let deviceId {
            request.setValue(deviceId, forHTTPHeaderField: "x-procrastimate-device")
        }
        let task = URLSession.shared.webSocketTask(with: request)
        socket = task
        pump.connect(
            send: { [weak task] data in task?.send(.data(data)) { _ in } },
            level: { [weak self] value in Task { @MainActor in self?.onLevel(value) } }
        )
        task.resume()
        receive()
        do {
            try startEngine()
        } catch {
            finish(.failed("The microphone is off. You can type the ramble instead."))
        }
    }

    private func startEngine() throws {
        let audio = AVAudioEngine()
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.record, mode: .measurement, options: [.duckOthers])
        try session.setActive(true, options: .notifyOthersOnDeactivation)
        let input = audio.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else { throw SpeechDictation.Failure.unsupported }
        try input.installAudioTap(onBus: 0, bufferSize: 4096, format: format) { [pump] buffer, _ in
            pump.append(buffer)
        }
        tapped = true
        audio.prepare()
        try audio.start()
        engine = audio
    }

    private func receive() {
        let token = epoch
        socket?.receive { [weak self] result in
            Task { @MainActor in
                guard let self, token == self.epoch, !self.stopped else { return }
                switch result {
                case let .success(.string(text)):
                    self.handle(text)
                case let .success(.data(data)):
                    if let text = String(data: data, encoding: .utf8) { self.handle(text) }
                case .failure:
                    self.finish(self.userStop || self.heard ? .stopped : .failed("Ramble needs a connection"))
                    return
                @unknown default:
                    return
                }
                if !self.stopped { self.receive() }
            }
        }
    }

    private func handle(_ raw: String) {
        guard let data = raw.data(using: .utf8), let event = try? JSONDecoder().decode(RambleMessage.self, from: data) else { return }
        switch event.type {
        case "started":
            heard = true
        case "partial":
            partial = event.text ?? ""
            publish()
        case "committed":
            let joined = join(committed, event.text ?? "")
            committed = joined.text
            partial = ""
            publish()
        case "error":
            let limit = event.code == "daily-limit"
            finish(.failed(limit ? "Ramble's daily limit is used up" : (event.message ?? "Ramble needs a connection")))
        case "ended":
            finish(userStop || heard ? .stopped : .failed("Ramble needs a connection"))
        default:
            break
        }
    }

    private func publish() {
        heard = true
        let joined = join(committed, partial)
        onText(joined.text, joined.partialStart)
    }

    private func finish(_ end: End) {
        guard !stopped else { return }
        stopped = true
        haltEngine()
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
        onEnd(end)
    }

    private func haltEngine() {
        if tapped {
            engine?.inputNode.removeTap(onBus: 0)
            tapped = false
        }
        engine?.stop()
        engine = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private struct RambleMessage: Decodable {
        var type: String
        var text: String?
        var code: String?
        var message: String?
    }
}

private func join(_ committed: String, _ partial: String) -> (text: String, partialStart: Int) {
    let tail = partial.trimmingCharacters(in: .whitespacesAndNewlines)
    let base = committed as NSString
    if committed.isEmpty { return (tail, 0) }
    if tail.isEmpty { return (committed, base.length) }
    let gap = committed.hasSuffix(" ") || tail.hasPrefix(" ") ? "" : " "
    return (committed + gap + tail, base.length + (gap as NSString).length)
}

/// Downsamples mic buffers to 16 kHz 16-bit frames. The tap calls it off the main actor.
private final class RamblePump: Sendable {
    private struct State {
        var send: (@Sendable (Data) -> Void)?
        var level: (@Sendable (Float) -> Void)?
        var pending: [Int16] = []
        var frac = 0.0
    }

    private let state = Mutex(State())

    func connect(send: @escaping @Sendable (Data) -> Void, level: @escaping @Sendable (Float) -> Void) {
        state.withLock {
            $0.send = send
            $0.level = level
        }
    }

    func append(_ buffer: AVReadOnlyAudioPCMBuffer) {
        guard case let .float(channel) = buffer.channelData(0) else { return }
        let frames = buffer.frameLength
        let step = buffer.format.sampleRate / 16_000
        guard step > 0 else { return }
        let (chunks, peak, send, level) = state.withLock { state in
            var index = state.frac
            var peak: Float = 0
            while index < Double(frames) {
                let sample = max(-1, min(1, channel[Int(index)]))
                peak = max(peak, abs(sample))
                state.pending.append(Int16(sample < 0 ? sample * 32_768 : sample * 32_767))
                index += step
            }
            state.frac = index - Double(frames)
            var chunks: [Data] = []
            while state.pending.count >= 1600 {
                var bytes = Data(capacity: 3200)
                for sample in state.pending.prefix(1600) {
                    bytes.append(UInt8(truncatingIfNeeded: Int(sample)))
                    bytes.append(UInt8(truncatingIfNeeded: Int(sample) >> 8))
                }
                state.pending.removeFirst(1600)
                chunks.append(bytes)
            }
            return (chunks, peak, state.send, state.level)
        }
        for chunk in chunks { send?(chunk) }
        level?(peak)
    }
}
