import Core
import Foundation
import Observation

/// A spoken task in the drawer. Its id survives reparsing and the move from live to reviewed, so rows never jump.
/// `task.subtasks` is unused; `subtasks` holds them with their own ids.
struct RambleEntry: Identifiable, Hashable {
    let id: String
    var task: RambleTask
    var subtasks: [RambleEntry]

    /// The grammar reparses the whole transcript on each update and a ramble only grows at its end, so the task at
    /// a given position is the same task from one update to the next.
    static func keyed(_ tasks: [RambleTask], base: Int) -> [RambleEntry] {
        func entry(_ task: RambleTask, _ id: String) -> RambleEntry {
            var bare = task
            bare.subtasks = []
            return RambleEntry(id: id, task: bare, subtasks: task.subtasks.enumerated().map { entry($1, "\(id).\($0)") })
        }
        return tasks.enumerated().map { entry($1, String(base + $0)) }
    }
}

/// The capture behind the Ramble drawer: one listening session at a time, the entries it settled and the ones still
/// arriving, and the transcript, so the drawer only lays them out. `review` holds the reviewed list, and talking
/// again appends to it.
@MainActor @Observable
final class RambleCapture {
    enum Phase: Equatable {
        case listening
        case finishing
        /// Waiting on Gemini's final outline.
        case structuring
        case review
    }

    /// What the grammar reads: the clock, the names of every space a task may land on, and how to read speech.
    struct Context {
        let now: Date
        let projects: [Project]
        let labels: [Label]
        let zone: TimeZone
        let mode: RambleMode

        func parse(_ text: String) -> RambleDraft {
            Ramble.parse(text, now: now, projects: projects, labels: labels, in: zone, commands: mode == .commands)
        }

        func resolve(_ outline: RambleOutline) -> [RambleTask] {
            Ramble.resolveOutline(outline, now: now, projects: projects, labels: labels, in: zone)
        }
    }

    /// Past this the last outline stands, with the grammar's tasks for the words after it.
    static let settleTimeout = Duration.seconds(6)

    private(set) var phase = Phase.listening
    private(set) var entries: [RambleEntry] = []
    private(set) var live: [RambleEntry] = []
    private(set) var transcript = ""
    private(set) var tokens: [RambleToken] = []
    private(set) var notice: String?
    private(set) var startedAt = Date.now
    let session = RambleSession()

    @ObservationIgnored private var nextKey = 0
    @ObservationIgnored private var generation = 0
    @ObservationIgnored private var liveParse: Task<Void, Never>?
    @ObservationIgnored private var outliner: RambleOutliner?
    /// The last settled capture, which switching the mode reads again.
    @ObservationIgnored private var capture: (transcript: String, ids: [String])?
    @ObservationIgnored private var context: () -> Context = { preconditionFailure("start first") }

    var items: [RambleEntry] { entries + live }
    var saving: [RambleEntry] { entries.filter { !$0.task.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty } }
    var busy: Bool { phase != .review }

    func start(choice: DictationChoice, deviceId: String, context: @escaping () -> Context) {
        self.context = context
        generation += 1
        let token = generation
        phase = .listening
        transcript = ""
        tokens = []
        live = []
        notice = nil
        startedAt = .now
        outliner?.stop()
        outliner = context().mode == .smart ? newOutliner(token: token) : nil
        session.onText = { [weak self] spoken, _ in
            guard let self, token == generation, phase == .listening || phase == .finishing else { return }
            transcript = spoken
            if context().mode == .smart { outliner?.update(spoken) }
            parseLive(spoken, token: token)
        }
        session.onEnd = { [weak self] end in
            guard let self, token == generation else { return }
            switch end {
            case .stopped: notice = nil
            case .typed: notice = "Dictation is not available here. You can type the tasks instead."
            case let .failed(message): notice = message
            }
            Task { await self.settle(token: token) }
        }
        Task { await session.start(choice: choice, deviceId: deviceId) }
    }

    func stop() {
        guard phase == .listening else { return }
        phase = .finishing
        session.stop()
    }

    /// Ends the capture for good: a late callback from the session finds another generation.
    func end() {
        generation += 1
        liveParse?.cancel()
        outliner?.stop()
        session.stop()
    }

    /// Reads the capture in progress, or the last one, again in the mode the context now names; edits to its tasks
    /// give way to the new read.
    func modeChanged() async {
        let c = context()
        switch phase {
        case .listening, .finishing:
            if c.mode == .smart {
                if outliner == nil { outliner = newOutliner(token: generation) }
                outliner?.update(transcript)
            }
            parseLive(transcript, token: generation)
        case .review:
            guard let previous = capture else { return }
            let tasks = await read(previous.transcript, token: generation)
            phase = .review
            guard let tasks, capture.map({ $0.ids == previous.ids }) == true else { return }
            let at = entries.firstIndex { previous.ids.contains($0.id) }
            let settled = RambleEntry.keyed(tasks, base: nextKey)
            nextKey += settled.count
            var kept = entries.filter { !previous.ids.contains($0.id) }
            kept.insert(contentsOf: settled, at: min(at ?? kept.count, kept.count))
            entries = kept
            capture = (previous.transcript, settled.map(\.id))
            phase = .review
        case .structuring:
            return
        }
    }

    func find(_ id: String) -> RambleEntry? {
        func search(_ list: [RambleEntry]) -> RambleEntry? {
            for entry in list {
                if entry.id == id { return entry }
                if let found = search(entry.subtasks) { return found }
            }
            return nil
        }
        return search(entries)
    }

    func update(_ id: String, _ change: (inout RambleTask) -> Void) {
        func apply(_ list: inout [RambleEntry]) -> Bool {
            for index in list.indices {
                if list[index].id == id {
                    change(&list[index].task)
                    return true
                }
                if apply(&list[index].subtasks) { return true }
            }
            return false
        }
        _ = apply(&entries)
    }

    func remove(_ id: String) {
        func prune(_ list: [RambleEntry]) -> [RambleEntry] {
            list.filter { $0.id != id }.map { entry in
                var entry = entry
                entry.subtasks = prune(entry.subtasks)
                return entry
            }
        }
        entries = prune(entries)
    }

    /// The grammar runs off the main thread on every transcript update, so a long ramble never stalls the drawer. In
    /// smart mode the latest outline leads the list.
    private func parseLive(_ text: String, token: Int) {
        liveParse?.cancel()
        let c = context(), base = nextKey, latest = outliner?.latest
        liveParse = Task {
            let (draft, tasks) = await Task.detached(priority: .userInitiated) {
                let draft = c.parse(text)
                let tasks = c.mode == .commands
                    ? draft.tasks
                    : RambleOutliner.smartTasks(text, latest: latest, parse: { c.parse($0).tasks }, resolve: c.resolve)
                return (draft, tasks)
            }.value
            guard !Task.isCancelled, token == generation, phase == .listening || phase == .finishing else { return }
            tokens = draft.tokens
            live = RambleEntry.keyed(tasks, base: base)
            if draft.ended { stop() }
        }
    }

    private func newOutliner(token: Int) -> RambleOutliner {
        RambleOutliner(
            request: { [context] text in
                let c = context()
                let input = API.RambleOutlineInput(
                    transcript: text,
                    today: Dates.toDateKey(c.now, in: c.zone),
                    time: Triggers.wallTime(c.now.epochMilliseconds, in: c.zone),
                    projects: c.projects.map(\.name),
                    labels: c.labels.map(\.name)
                )
                return try await APIClient.send(API.Endpoints.RambleOutline.self, input)
            },
            onOutline: { [weak self] in
                guard let self, token == generation, phase == .listening || phase == .finishing else { return }
                parseLive(transcript, token: token)
            }
        )
    }

    /// What a finished transcript reads as in the current mode, or nil when a newer capture took over.
    private func read(_ text: String, token: Int) async -> [RambleTask]? {
        let c = context()
        guard c.mode == .smart, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return c.parse(text).tasks }
        if outliner == nil { outliner = newOutliner(token: token) }
        guard let outliner, !outliner.off else { return c.parse(text).tasks }
        phase = .structuring
        let outline = await outliner.settle(text, timeout: Self.settleTimeout)
        guard token == generation else { return nil }
        if let outline { return c.resolve(outline) }
        // A recognizer that revised earlier words leaves the last outline reading a different transcript.
        guard let latest = outliner.latest, text.hasPrefix(latest.transcript) else { return c.parse(text).tasks }
        return RambleOutliner.smartTasks(text, latest: latest, parse: { c.parse($0).tasks }, resolve: c.resolve)
    }

    /// The final transcript decides the tasks. Keys carry over, so rows stay where they are.
    private func settle(token: Int) async {
        liveParse?.cancel()
        let text = transcript
        guard let tasks = await read(text, token: token) else { return }
        let settled = RambleEntry.keyed(tasks, base: nextKey)
        nextKey += settled.count
        live = []
        entries += settled
        capture = (text, settled.map(\.id))
        phase = .review
    }
}
