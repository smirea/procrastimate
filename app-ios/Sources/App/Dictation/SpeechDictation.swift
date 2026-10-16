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
        for await path in NWPathMonitor() { return path.status == .satisfied }
        return false
    }
}

/// Apple's on-device dictation: `SpeechAnalyzer` with a `DictationTranscriber`, so audio never leaves the phone and
/// it works offline. The language assets download on first use. Only the microphone needs permission.
@MainActor
final class SpeechDictation {
    enum Failure: Error {
        case unsupported
        case denied
    }

    private var engine: AVAudioEngine?
    private var input: AsyncStream<AnalyzerInput>.Continuation?
    private var analyzer: SpeechAnalyzer?
    private var reader: Task<Void, Never>?

    /// Streams the transcript so far, finalized text followed by the words still being recognized.
    /// The tap also writes each buffer's peak to `meter` for the waveform.
    func start(meter: LevelMeter, onText: @escaping @MainActor (String) -> Void) async throws {
        guard let locale = await DictationTranscriber.supportedLocale(equivalentTo: Locale(identifier: "en-US")) else {
            throw Failure.unsupported
        }
        let transcriber = DictationTranscriber(
            locale: locale,
            contentHints: [],
            transcriptionOptions: [.punctuation],
            reportingOptions: [.volatileResults, .frequentFinalization],
            attributeOptions: []
        )
        if let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
            try await request.downloadAndInstall()
        }
        let converter = try await AnalyzerInputConverter.converter(compatibleWith: [transcriber])
        let (stream, input) = AsyncStream.makeStream(of: AnalyzerInput.self)
        let analyzer = SpeechAnalyzer(modules: [transcriber])
        reader = Task {
            var finalized = AttributedString()
            do {
                for try await result in transcriber.results {
                    if result.isFinal { finalized += result.text }
                    onText(String((result.isFinal ? finalized : finalized + result.text).characters))
                }
            } catch {
                ErrorReport.log("Dictation stopped", detail: String(reflecting: error))
            }
        }
        try await analyzer.start(inputSequence: stream)
        self.analyzer = analyzer
        self.input = input

        #if DEBUG
        if let path = ProcessInfo.processInfo.environment["PROCRASTIMATE_RAMBLE_AUDIO"] {
            try Self.play(URL(fileURLWithPath: path), through: converter, into: input)
            return
        }
        #endif
        guard await AVAudioApplication.requestRecordPermission() else {
            cancel()
            throw Failure.denied
        }
        let audio = AVAudioEngine()
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.record, mode: .measurement, options: [.duckOthers])
            try session.setActive(true, options: .notifyOthersOnDeactivation)
            let node = audio.inputNode
            let format = node.outputFormat(forBus: 0)
            guard format.sampleRate > 0, format.channelCount > 0 else { throw Failure.unsupported }
            try node.installAudioTap(onBus: 0, bufferSize: 1024, format: format, tapProvider: Self.feed(converter, input, meter))
            audio.prepare()
            try audio.start()
        } catch {
            cancel()
            throw error
        }
        engine = audio
    }

    /// The tap runs on the audio thread. The converter is only ever used there once the tap is installed.
    nonisolated private static func feed(
        _ converter: AnalyzerInputConverter,
        _ input: AsyncStream<AnalyzerInput>.Continuation,
        _ meter: LevelMeter
    ) -> @Sendable (AVReadOnlyAudioPCMBuffer, AVAudioTime) -> Void {
        nonisolated(unsafe) let converter = converter
        return { buffer, time in
            if case let .float(channel) = buffer.channelData(0) {
                var peak: Float = 0
                for index in 0 ..< Int(buffer.frameLength) { peak = max(peak, abs(channel[index])) }
                meter.set(peak)
            }
            guard let items = try? converter.convert(AVAudioPCMBuffer(copying: buffer), at: time) else { return }
            for item in items { input.yield(item) }
        }
    }

    #if DEBUG
    /// DEBUG-only. The simulator has no microphone, so `PROCRASTIMATE_RAMBLE_AUDIO` names a spoken audio file that
    /// goes through the same converter and analyzer in tap-sized chunks.
    private static func play(_ url: URL, through converter: AnalyzerInputConverter, into input: AsyncStream<AnalyzerInput>.Continuation) throws {
        let file = try AVAudioFile(forReading: url)
        while file.framePosition < file.length {
            let buffer = try file.read(frameCount: 1024)
            for item in try converter.convert(AVAudioPCMBuffer(copying: buffer), at: nil) { input.yield(item) }
        }
        for item in try converter.flush() { input.yield(item) }
    }
    #endif

    /// Stops listening and waits until the words already heard are final, so the last of them are not lost.
    func finish() async {
        let analyzer = self.analyzer
        let reader = self.reader
        halt()
        try? await analyzer?.finalizeAndFinishThroughEndOfInput()
        await reader?.value
    }

    func cancel() {
        reader?.cancel()
        halt()
    }

    private func halt() {
        engine?.inputNode.removeTap(onBus: 0)
        engine?.stop()
        engine = nil
        input?.finish()
        input = nil
        analyzer = nil
        reader = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}
