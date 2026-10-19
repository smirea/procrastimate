import Foundation
import GRDB
import Network
import Observation

/// The tasks with a write in PowerSync's upload queue that has not reached the server, read from the queue itself, as
/// on the web. Online, an upload leaves within the 100 ms throttle and lands a moment later, so a task shows only once
/// its first queued write has waited `grace`; offline it shows at once.
@MainActor @Observable
final class UnsyncedTasks {
    static let grace = Duration.seconds(3)

    private(set) var shown: Set<String> = []
    /// Each queued task, with its grace while it runs; nil once it ran out.
    @ObservationIgnored private var queued: [String: Task<Void, Never>?] = [:]
    @ObservationIgnored private var offline = false
    @ObservationIgnored private var observation: AnyDatabaseCancellable?
    @ObservationIgnored private var path: Task<Void, Never>?

    func contains(_ taskID: String) -> Bool { shown.contains(taskID) }

    /// `offline` holds the device offline whatever the network says, for a launch that never connects.
    func start(in pool: DatabasePool, offline forced: Bool) {
        offline = forced
        observation = ValueObservation.tracking { db in
            // PowerSync queues a write from inside its own virtual table, which GRDB never sees change, so the change log
            // that every local write also lands in is tracked too. Emptying the queue is a plain delete GRDB does see.
            _ = try LocalDatabase.lastChange(db)
            return try String.fetchSet(
                db,
                sql: "SELECT DISTINCT json_extract(data, '$.id') FROM ps_crud WHERE json_extract(data, '$.type') = 'tasks'"
            )
        }
        .start(
            in: pool,
            onError: { ErrorReport.log("The upload queue stopped updating", error: $0) },
            onChange: { [weak self] in self?.update($0) }
        )
        guard !forced else { return }
        path = Task { [weak self] in
            for await path in NWPathMonitor() {
                guard let self else { return }
                offline = path.status != .satisfied
                show()
            }
        }
    }

    private func update(_ ids: Set<String>) {
        for (id, grace) in queued where !ids.contains(id) {
            grace?.cancel()
            queued[id] = nil
        }
        for id in ids where queued[id] == nil {
            queued[id] = Task { [weak self] in
                try? await Task.sleep(for: Self.grace)
                guard !Task.isCancelled, let self else { return }
                queued[id] = .some(nil)
                show()
            }
        }
        show()
    }

    /// A task once shown stays until its writes leave the queue, so coming back online never hides it for a moment.
    private func show() {
        let next = Set(queued.compactMap { id, grace in offline || grace == nil || shown.contains(id) ? id : nil })
        if next != shown { shown = next }
    }
}
