import Core
import Foundation

/// Keeps Gemini's outline of a ramble current while it is spoken, so stopping rarely waits on a request. One request
/// is in flight at a time, sent once the words settle or after `maxWait` of speech without a pause; the newest
/// transcript goes next. Two failures in a row turn it
/// off for the session, so a passing rate limit costs one read, and the grammar's tasks stand. Mirrors `Outliner` in
/// `app-web/src/lib/ramble/outliner.ts`.
@MainActor
final class RambleOutliner {
    typealias Request = @MainActor (String) async throws -> RambleOutline

    private(set) var latest: (transcript: String, outline: RambleOutline)?
    private(set) var off = false
    private var failures = 0
    private var pending: String?
    private var inflight: (transcript: String, task: Task<RambleOutline?, Never>)?
    private var timer: Task<Void, Never>?
    /// When the oldest unsent words arrived, so nonstop speech still gets read.
    private var waitingSince: ContinuousClock.Instant?
    private let request: Request
    private let onOutline: () -> Void
    private let settleDelay: Duration
    private let maxWait: Duration

    init(
        settle: Duration = .milliseconds(500),
        maxWait: Duration = .seconds(2),
        request: @escaping Request,
        onOutline: @escaping () -> Void
    ) {
        self.request = request
        self.onOutline = onOutline
        settleDelay = settle
        self.maxWait = maxWait
    }

    func update(_ transcript: String) {
        guard !off, !Self.blank(transcript), transcript != latest?.transcript else { return }
        pending = transcript
        let since = waitingSince ?? .now
        waitingSince = since
        timer?.cancel()
        guard inflight == nil else { return }
        let delay = max(.zero, min(settleDelay, maxWait - (ContinuousClock.now - since)))
        timer = Task { [weak self] in
            try? await Task.sleep(for: delay)
            guard !Task.isCancelled else { return }
            self?.send()
        }
    }

    /// The outline of exactly `transcript`, or nil when there is none within `timeout`.
    func settle(_ transcript: String, timeout: Duration) async -> RambleOutline? {
        timer?.cancel()
        if let latest, latest.transcript == transcript { return latest.outline }
        guard !off, !Self.blank(transcript) else { return nil }
        if inflight?.transcript != transcript {
            inflight?.task.cancel()
            inflight = nil
            pending = transcript
            send()
        }
        guard let task = inflight?.task else { return nil }
        let first = FirstAnswer<RambleOutline?>()
        return await withCheckedContinuation { continuation in
            first.continuation = continuation
            Task { first.answer(await task.value) }
            Task {
                try? await Task.sleep(for: timeout)
                if first.continuation != nil { ErrorReport.log("Ramble outline timed out", detail: "\(timeout)") }
                first.answer(nil)
            }
        }
    }

    func stop() {
        timer?.cancel()
        inflight?.task.cancel()
        inflight = nil
        off = true
    }

    private func send() {
        guard let transcript = pending else { return }
        pending = nil
        waitingSince = nil
        let task = Task { [weak self, request] () -> RambleOutline? in
            do {
                let outline = try await request(transcript)
                guard !Task.isCancelled, let self else { return nil }
                failures = 0
                latest = (transcript, outline)
                onOutline()
                return outline
            } catch {
                if !Task.isCancelled, let self {
                    ErrorReport.log("Ramble outline failed", error: error)
                    failures += 1
                    if failures >= 2 { off = true }
                }
                return nil
            }
        }
        inflight = (transcript, task)
        Task { [weak self] in
            _ = await task.value
            guard let self, inflight?.task == task else { return }
            inflight = nil
            if pending != nil, !off { send() }
        }
    }

    nonisolated private static func blank(_ text: String) -> Bool { text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    /// The live list in smart mode: the outline's tasks, then the grammar's for the words spoken since it was asked.
    /// When the recognizer revised earlier words, the outline alone stands until the next one.
    nonisolated static func smartTasks(
        _ transcript: String,
        latest: (transcript: String, outline: RambleOutline)?,
        parse: (String) -> [RambleTask],
        resolve: (RambleOutline) -> [RambleTask]
    ) -> [RambleTask] {
        guard let latest else { return parse(transcript) }
        let tail = transcript.hasPrefix(latest.transcript) ? String(transcript.dropFirst(latest.transcript.count)) : ""
        return resolve(latest.outline) + (blank(tail) ? [] : parse(tail))
    }
}

/// Resumes once, with whichever answer comes first.
@MainActor
private final class FirstAnswer<Value: Sendable> {
    var continuation: CheckedContinuation<Value, Never>?

    func answer(_ value: Value) {
        continuation?.resume(returning: value)
        continuation = nil
    }
}
