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
        case structuring
        case review
    }

    /// What the grammar reads: the clock and the names of the space the drawer opened on.
    struct Context {
        let now: Date
        let projects: [Project]
        let labels: [Label]
        let zone: TimeZone
    }

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
        RambleModel.prewarm()
        session.onText = { [weak self] spoken, _ in
            guard let self, token == generation, phase == .listening || phase == .finishing else { return }
            transcript = spoken
            parseLive(spoken, token: token)
        }
        session.onEnd = { [weak self] end in
            guard let self, token == generation else { return }
            switch end {
            case .stopped: notice = nil
            case .typed: notice = "Dictation is not available here. You can type the tasks instead."
            case let .failed(message): notice = message
            }
            finish(token: token)
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
        session.stop()
    }

    func find(_ id: String) -> RambleEntry? {
        for entry in entries {
            if entry.id == id { return entry }
            if let subtask = entry.subtasks.first(where: { $0.id == id }) { return subtask }
        }
        return nil
    }

    func update(_ id: String, _ change: (inout RambleTask) -> Void) {
        for index in entries.indices {
            if entries[index].id == id { return change(&entries[index].task) }
            if let sub = entries[index].subtasks.firstIndex(where: { $0.id == id }) { return change(&entries[index].subtasks[sub].task) }
        }
    }

    func remove(_ id: String) {
        entries = entries
            .filter { $0.id != id }
            .map { entry in
                var entry = entry
                entry.subtasks.removeAll { $0.id == id }
                return entry
            }
    }

    /// The grammar runs off the main thread on every transcript update, so a long ramble never stalls the drawer.
    private func parseLive(_ text: String, token: Int) {
        liveParse?.cancel()
        let c = context(), base = nextKey
        liveParse = Task {
            let draft = await Task.detached(priority: .userInitiated) {
                Ramble.parse(text, now: c.now, projects: c.projects, labels: c.labels, in: c.zone)
            }.value
            guard !Task.isCancelled, token == generation, phase == .listening || phase == .finishing else { return }
            tokens = draft.tokens
            live = RambleEntry.keyed(draft.tasks, base: base)
            if draft.ended { stop() }
        }
    }

    /// The final transcript decides the tasks. The on-device model then picks the structure where the transcript backs
    /// it up; spoken commands keep the grammar's split.
    private func finish(token: Int) {
        liveParse?.cancel()
        let transcript = transcript, c = context()
        let ramble = Ramble.parse(transcript, now: c.now, projects: c.projects, labels: c.labels, in: c.zone)
        guard !ramble.tasks.isEmpty, !Ramble.usesCommands(ramble) else { return settle(ramble.tasks) }
        phase = .structuring
        live = RambleEntry.keyed(ramble.tasks, base: nextKey)
        Task {
            let split = await RambleModel.split(transcript)
            guard token == generation else { return }
            let structured = split.flatMap {
                Ramble.structured($0, transcript: transcript, draft: ramble, now: c.now, projects: c.projects, labels: c.labels, in: c.zone)
            }
            settle(structured ?? ramble.tasks)
        }
    }

    private func settle(_ tasks: [RambleTask]) {
        let settled = RambleEntry.keyed(tasks, base: nextKey)
        nextKey += settled.count
        live = []
        entries += settled
        phase = .review
    }

}
