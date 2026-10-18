import Core
import Foundation
import GRDB
import Observation
import PowerSync

/// The store over the local database, and PowerSync's connection while a session token exists. Commits reach the
/// database through one serial queue, in order; every change to the synced tables, local or streamed, reloads the
/// store. App Intents and Spotlight use the same instance.
@MainActor @Observable
final class SyncClient {
    /// The owner of rows written before anyone signs in, as under the DEBUG launch flag without a session.
    static let localOwner = "local"

    private static var current: SyncClient?

    /// The one instance, created by the app at launch or by whichever App Intent runs first.
    static func shared(clock: AppClock) -> SyncClient {
        if let current { return current }
        let created = SyncClient(clock: clock)
        current = created
        return created
    }

    let store: Store
    @ObservationIgnored let database: LocalDatabase
    @ObservationIgnored private let clock: AppClock
    @ObservationIgnored private let ready: Task<Void, any Error>
    @ObservationIgnored private let writes: AsyncStream<RowBatch>.Continuation
    @ObservationIgnored private var observation: AnyDatabaseCancellable?
    @ObservationIgnored private var askedForPeople: Set<String> = []
    @ObservationIgnored weak var session: Session?
    @ObservationIgnored weak var toasts: Toasts?

    private init(clock: AppClock) {
        self.clock = clock
        let database: LocalDatabase
        do {
            database = try LocalDatabase()
        } catch {
            fatalError("Could not open the local database at \(LocalDatabase.url.path): \(error)")
        }
        self.database = database
        let me = Session.userID ?? Self.localOwner
        // The views exist from the last launch, so the first frame shows the data. A fresh file has none yet.
        let rows = (try? database.pool.read(LocalDatabase.rows)) ?? StoredRows()
        store = Telemetry.trace("Load store", operation: "store.load") {
            Store(me: me, spaces: Spaces(rows, me: me), people: DeviceDefaults.people, clock: clock)
        }
        ready = Task { try await database.ready() }
        let (batches, writes) = AsyncStream.makeStream(of: RowBatch.self)
        self.writes = writes
        store.writer = { writes.yield($0) }
        Task { await run(batches) }
    }

    private func run(_ batches: AsyncStream<RowBatch>) async {
        do {
            try await ready.value
        } catch {
            fatalError("Could not set up the local database: \(error)")
        }
        observe()
        for await batch in batches {
            do {
                try await database.write(batch)
                if store.written(batch.version) { await reloadNow() }
            } catch {
                ErrorReport.log("Could not save a change", error: error)
                _ = store.written(batch.version)
                await reloadNow()
            }
        }
    }

    private func observe() {
        observation = ValueObservation.tracking(LocalDatabase.rows).start(
            in: database.pool,
            onError: { ErrorReport.log("The local database stopped updating", error: $0) },
            onChange: { [weak self] rows in self?.reload(rows) }
        )
    }

    private func reloadNow() async {
        do {
            reload(try await database.pool.read(LocalDatabase.rows))
        } catch {
            ErrorReport.log("Could not read the local database", error: error)
        }
    }

    private func reload(_ rows: StoredRows) {
        store.reload(Spaces(rows, me: store.me))
        let unknown = Set(store.spaces.keys).subtracting(store.people.map(\.id)).subtracting(askedForPeople)
        if !unknown.isEmpty {
            askedForPeople.formUnion(unknown)
            Task { await loadPeople() }
        }
    }

    private var connector: SyncConnector {
        SyncConnector(
            rejected: { [weak self] rows in await self?.rejected(rows) },
            signedOut: { [weak self] in await self?.reject() }
        )
    }

    /// Connects while a real session token is in the Keychain. The DEBUG launch flag is not a token.
    func start() {
        guard SessionToken.read() != nil, !Launch.offline else { return }
        Task { await connect() }
    }

    private func connect() async {
        do {
            try await ready.value
            try await database.powerSync.connect(
                connector: connector, options: ConnectOptions(crudThrottle: 0.2, retryDelay: 2)
            )
        } catch {
            ErrorReport.log("Could not start sync", error: error)
            return
        }
        do {
            try await database.powerSync.waitForFirstSync()
        } catch {
            return
        }
        // After the first sync, so the server's settings row is here and the zone only patches it.
        store.noteTimeZone(clock.timeZone.identifier)
        await loadPeople()
    }

    /// Back in the foreground: reconnects when the stream dropped while the app was away.
    func resume() {
        let status = database.powerSync.currentStatus
        guard SessionToken.read() != nil, !Launch.offline, !status.connected, !status.connecting else { return }
        Task { await connect() }
    }

    /// Pull to refresh: reconnects if needed and waits, up to five seconds, for the stream to catch up.
    func refresh() async {
        guard !Launch.offline else { return }
        if !database.powerSync.currentStatus.connected { await connect() }
        await loadPeople()
        await waitUntil(.seconds(5)) { status, _ in status.connected && !status.downloading && !status.uploading }
    }

    /// Waits, up to ten seconds, until this device's queued writes reached the server, for a request the server can only
    /// answer once it has them, like sharing a task just created.
    func flush() async {
        await waitUntil(.seconds(10)) { _, pending in !pending }
    }

    private func waitUntil(_ limit: Duration, _ done: (any SyncStatusData, Bool) -> Bool) async {
        let deadline = ContinuousClock.now + limit
        while ContinuousClock.now < deadline {
            let pending = ((try? await database.powerSync.getCrudBatch(limit: 1)) ?? nil) != nil
            if done(database.powerSync.currentStatus, pending) { return }
            try? await Task.sleep(for: .milliseconds(100))
        }
    }

    func signOut() {
        Task { try? await database.powerSync.disconnect() }
        if let token = SessionToken.read() {
            var request = URLRequest(url: AppEnvironment.apiURL.appending(path: "api/auth/sign-out"))
            request.httpMethod = "POST"
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            Task { _ = try? await APIClient.session.data(for: request) }
        }
        SessionToken.clear()
        session?.signedIn = Launch.signedIn
    }

    /// Another user signed in on this device: none of the previous one's rows, images, or names stay or upload.
    func switchUser(to id: String) async {
        try? await ready.value
        do {
            try await database.powerSync.disconnectAndClear()
        } catch {
            ErrorReport.log("Could not clear the previous user's data", error: error)
        }
        store.switchUser(to: id)
        askedForPeople = []
        TaskImages.clearLocal()
    }

    private func reject() {
        Task { try? await database.powerSync.disconnect() }
        SessionToken.clear()
        session?.signedIn = Launch.signedIn
    }

    private func rejected(_ rows: [(kind: EntityKind, id: String)]) {
        let shown = Snapshot(
            tasks: store.allTasks, projects: store.allProjects, sections: store.allSections, labels: store.allLabels,
            settings: store.snapshot.settings
        )
        if let notice = Rows.rejectionNotice(shown, rows) { toasts?.show(notice) }
    }

    #if DEBUG
    /// Writes another user's space straight into the local database, with the `access` rows the server would add,
    /// for the DEBUG demos that show sharing without a second account.
    func seed(space owner: String, _ data: Snapshot, access: [Access]) async {
        do {
            try await ready.value
            try await database.write(RowBatch(version: 0, owner: owner, writes: Rows.rowWrites(.empty, data)))
            try await database.pool.write { db in
                for row in access { try SyncedRow(id: row.id, owner: nil, value: row).insert(db) }
            }
        } catch {
            ErrorReport.log("Could not seed the demo space", error: error)
        }
    }
    #endif

    /// Names for the owners of shared spaces and the people the user's space has met.
    private func loadPeople() async {
        guard SessionToken.read() != nil else { return }
        do {
            let found = try await APIClient.send(API.Endpoints.PeopleSearch.self, NoInput(), query: ["q": ""])
            store.rememberPeople(found.people)
        } catch {
            ErrorReport.log("Could not load people", error: error)
        }
    }
}

/// What the app keeps on this device only, outside the synced database.
enum DeviceDefaults {
    private static let peopleKey = "procrastimate-people"
    private static let remindersCheckedKey = "procrastimate-reminders-checked-at"
    private static let installKey = "procrastimate-install-id"

    /// The people cache, so names show offline.
    static var people: [Person] {
        get {
            UserDefaults.standard.data(forKey: peopleKey).flatMap { try? JSONDecoder().decode([Person].self, from: $0) } ?? []
        }
        set { UserDefaults.standard.set(try? JSONEncoder().encode(newValue), forKey: peopleKey) }
    }

    /// When the app last showed due reminders, so each shows once.
    static var remindersCheckedAt: Int? {
        get { UserDefaults.standard.object(forKey: remindersCheckedKey) as? Int }
        set { UserDefaults.standard.set(newValue, forKey: remindersCheckedKey) }
    }

    /// This install's id, which Ramble names the device by. Created on first use.
    static var installID: String {
        if let id = UserDefaults.standard.string(forKey: installKey) { return id }
        let id = UUID().uuidString.lowercased()
        UserDefaults.standard.set(id, forKey: installKey)
        return id
    }
}
