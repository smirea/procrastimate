import Foundation
import GRDB
import Network
import Observation

/// The tasks with a write in PowerSync's upload queue that has not reached the server, read from the queue itself, as
/// on the web. Online, an upload leaves within the 100 ms throttle and lands a moment later, so a task shows only once
/// its oldest queued write has waited `grace`, and typing that uploads keystroke by keystroke, each one queued before
/// the last lands, never shows it. Offline it shows at once.
@MainActor @Observable
final class UnsyncedTasks {
    static let grace = Duration.seconds(3)

    private final class Queued {
        let row: Int64
        var ripe = false
        init(row: Int64) { self.row = row }
    }

    private(set) var shown: Set<String> = []
    @ObservationIgnored private var queued: [String: Queued] = [:]
    @ObservationIgnored private var offline = false
    @ObservationIgnored private var observation: AnyDatabaseCancellable?
    @ObservationIgnored private var path: Task<Void, Never>?

    func contains(_ taskID: String) -> Bool { shown.contains(taskID) }

    /// `offline` holds the device offline whatever the network says, for a launch that never connects.
    func start(in pool: DatabasePool, offline forced: Bool) {
        offline = forced
        observation = ValueObservation.tracking { db -> [String: Int64] in
            // PowerSync queues a write from inside its own virtual table, which GRDB never sees change, so the change log
            // that every local write also lands in is tracked too. Emptying the queue is a plain delete GRDB does see.
            _ = try LocalDatabase.lastChange(db)
            let rows = try Row.fetchAll(
                db,
                sql: "SELECT json_extract(data, '$.id') AS id, MIN(id) AS row FROM ps_crud WHERE json_extract(data, '$.type') = 'tasks' GROUP BY 1"
            )
            return Dictionary(uniqueKeysWithValues: rows.map { ($0["id"] as String, $0["row"] as Int64) })
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

    /// One grace per read covers every task whose oldest write changed in it, so an import ripens in one update.
    private func update(_ rows: [String: Int64]) {
        var next: [String: Queued] = [:]
        var waiting: [Queued] = []
        var shown = shown
        for (id, row) in rows {
            if let known = queued[id], known.row == row {
                next[id] = known
                continue
            }
            let entry = Queued(row: row)
            next[id] = entry
            waiting.append(entry)
            shown.remove(id)
        }
        queued = next
        if shown != self.shown { self.shown = shown }
        if !waiting.isEmpty {
            Task { [weak self] in
                try? await Task.sleep(for: Self.grace)
                for entry in waiting { entry.ripe = true }
                self?.show()
            }
        }
        show()
    }

    /// A shown task stays until its oldest write leaves the queue, so coming back online never hides it for a moment.
    private func show() {
        let next = Set(queued.compactMap { id, entry in offline || entry.ripe || shown.contains(id) ? id : nil })
        if next != shown { shown = next }
    }
}
