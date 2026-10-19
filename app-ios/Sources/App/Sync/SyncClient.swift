import Core
import Foundation
import GRDB
import Observation
import PowerSync

/// The store over the local database, and PowerSync's connection while a session token exists. Commits reach the
/// database through one serial queue, in order. Every change to the synced tables, local or streamed, lands in the change
/// log, and each read of it rebuilds only the spaces whose rows changed. App Intents and Spotlight use the same instance.
@MainActor @Observable
final class SyncClient {
    /// The owner of rows written without a session token, as under the DEBUG launch flag. It never syncs.
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
    private let unsynced = UnsyncedTasks()
    @ObservationIgnored private let clock: AppClock
    @ObservationIgnored private let ready: Task<Void, any Error>
    @ObservationIgnored private let writes: AsyncStream<RowBatch>.Continuation
    @ObservationIgnored private var observation: AnyDatabaseCancellable?
    /// The local database as last read, for the user the store belongs to, and the newest change that read covered.
    @ObservationIgnored private var rows: LocalRows
    @ObservationIgnored private var cursor: Int64?
    /// Reads run one after another, so an older read never lands after a newer one. A read still waiting to start
    /// covers every change that asks for another.
    @ObservationIgnored private var lastRead: Task<Void, Never>?
    @ObservationIgnored private var readQueued = false
    /// The session check fetches a sync token anyway, so the first connect uses it instead of asking again.
    @ObservationIgnored private var prefetched: PowerSyncCredentials?
    /// True while the local database cannot be read and no read for the current user ever worked, so the screen says so
    /// instead of showing an empty list nothing could be saved to.
    private(set) var unreadable = false
    @ObservationIgnored private var loaded = false
    @ObservationIgnored private var askedForPeople: Set<String> = []
    @ObservationIgnored private var connecting: Task<Void, Never>?
    #if DEBUG
    /// The `access` rows the sharing demo shows. The client never writes the `access` table, so they live here.
    @ObservationIgnored private var demoAccess: [Access] = []
    #endif
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
        // The Keychain keeps the owner beside the token, so only an app killed between storing the token and the session
        // check that names the owner leaves a token without one. Signing in again is simpler than filing rows under no one.
        if SessionToken.read() != nil, Session.userID == nil { SessionToken.clear() }
        let me = Session.userID ?? Self.localOwner
        // The views exist from the last launch, so the first frame shows the data. A fresh file has none yet.
        let rows = LocalRows(me: me)
        if let read = try? database.pool.read({ try LocalDatabase.read(since: nil, $0) }) {
            rows.apply(read.changes)
            cursor = read.cursor
            loaded = true
        }
        self.rows = rows
        store = Telemetry.trace("Load store", operation: "store.load") {
            Store(me: me, spaces: rows.spaces, people: DeviceDefaults.people, clock: clock)
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
        unsynced.start(in: database.pool, offline: Launch.offline)
        // The store holds the change until the server's settings row is here, so the zone only ever patches it.
        store.noteTimeZone(clock.timeZone.identifier)
        for await batch in batches {
            do {
                try await database.write(batch)
                if store.written(batch.version) { await reloadNow() }
            } catch {
                ErrorReport.log("Could not save a change", error: error)
                toasts?.show("Couldn’t save that change")
                _ = store.written(batch.version)
                await reloadNow()
            }
        }
    }

    private func observe() {
        observation = ValueObservation.tracking(LocalDatabase.lastChange).removeDuplicates().start(
            in: database.pool,
            onError: { ErrorReport.log("The local database stopped updating", error: $0) },
            onChange: { [weak self] _ in self?.reload() }
        )
    }

    private func reloadNow() async {
        await reload().value
    }

    /// Reads the local database again, after it could not be read.
    func retryRead() {
        reload()
    }

    @discardableResult
    private func reload() -> Task<Void, Never> {
        if readQueued, let lastRead { return lastRead }
        readQueued = true
        let previous = lastRead
        let read = Task {
            await previous?.value
            readQueued = false
            await readChanges()
        }
        lastRead = read
        return read
    }

    /// Applies what changed since the last read, then hands the store every space, which keeps whatever is equal.
    private func readChanges() async {
        let rows = self.rows
        let cursor = self.cursor
        let read: LocalDatabase.Read
        do {
            read = try await database.pool.read { try LocalDatabase.read(since: cursor, $0) }
        } catch {
            ErrorReport.log("Could not read the local database", error: error)
            if !loaded { unreadable = true }
            return
        }
        guard self.rows === rows else { return }
        loaded = true
        unreadable = false
        self.cursor = read.cursor
        rows.apply(read.changes)
        var spaces = rows.spaces
        #if DEBUG
        spaces.access += demoAccess
        #endif
        store.reload(spaces)
        // A space's owner, or whoever made or finished a task, names a byline, so someone this device has not met yet
        // sends it to ask.
        let named = Set(store.spaces.keys).union(store.allTasks.flatMap { [$0.createdBy, $0.completedBy].compactMap(\.self) })
        let unknown = named.subtracting(store.people.map(\.id)).subtracting(askedForPeople)
        if !unknown.isEmpty {
            askedForPeople.formUnion(unknown)
            Task { await loadPeople() }
        }
        guard read.long else { return }
        Task { [database] in
            do {
                try await database.trim(after: read)
            } catch {
                ErrorReport.log("Could not trim the change log", error: error)
            }
        }
    }

    private var connector: SyncConnector {
        SyncConnector(
            prefetched: { [weak self] in await self?.takePrefetched() },
            rejected: { [weak self] rows in await self?.rejected(rows) },
            signedOut: { [weak self] in await self?.reject() }
        )
    }

    func prefetch(_ sync: API.SyncToken) {
        prefetched = PowerSyncCredentials(endpoint: sync.endpoint, token: sync.token)
    }

    private func takePrefetched() -> PowerSyncCredentials? {
        defer { prefetched = nil }
        return prefetched
    }

    /// Connects while a real session token is in the Keychain. The DEBUG launch flag is not a token. Until PowerSync
    /// reports the attempt, a second call joins it rather than connecting again.
    func start() {
        guard SessionToken.read() != nil, !Launch.offline, store.me != Self.localOwner, connecting == nil else { return }
        connecting = Task { await connect() }
    }

    private func connect() async {
        do {
            try await ready.value
            // The web's values: an edit reaches another device within about a second, and a failed upload retries soon.
            try await database.powerSync.connect(
                connector: connector, options: ConnectOptions(crudThrottle: 0.1, retryDelay: 2)
            )
            connecting = nil
        } catch {
            connecting = nil
            ErrorReport.log("Could not start sync", error: error)
            return
        }
        await loadPeople()
    }

    /// A change to the task waits in this device's upload queue. Rows written without a session never sync, so they
    /// say nothing, except under the DEBUG offline launch, which stands in for a session without a network.
    func isUnsynced(_ taskID: String) -> Bool {
        (store.me != Self.localOwner || Launch.offline) && unsynced.contains(taskID)
    }

    func resume() {
        let status = database.powerSync.currentStatus
        guard !status.connected, !status.connecting else { return }
        start()
    }

    /// Pull to refresh: reconnects if needed and waits, up to five seconds, for the stream to catch up.
    func refresh() async {
        guard !Launch.offline else { return }
        if !database.powerSync.currentStatus.connected {
            start()
            await connecting?.value
        }
        await loadPeople()
        await waitUntil(.seconds(5)) { status, _ in status.connected && !status.downloading && !status.uploading }
    }

    /// Waits, up to ten seconds, until this device's queued writes reached the server, for a request the server can only
    /// answer once it has them, like sharing a task just created.
    func flush() async {
        await store.saved()
        await waitUntil(.seconds(10)) { _, pending in !pending }
    }

    /// Waits until the local database holds every commit made so far.
    func saved() async {
        await store.saved()
    }

    private func waitUntil(_ limit: Duration, _ done: (any SyncStatusData, Bool) -> Bool) async {
        let deadline = ContinuousClock.now + limit
        while ContinuousClock.now < deadline {
            let pending: Bool
            do {
                pending = try await database.powerSync.getCrudBatch(limit: 1) != nil
            } catch {
                pending = true
            }
            if done(database.powerSync.currentStatus, pending) { return }
            try? await Task.sleep(for: .milliseconds(100))
        }
    }

    func disconnect() {
        prefetched = nil
        Task { try? await database.powerSync.disconnect() }
    }

    func signOut() {
        if let token = SessionToken.read() {
            var request = URLRequest(url: AppEnvironment.apiURL.appending(path: "api/auth/sign-out"))
            request.httpMethod = "POST"
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            // The Worker sees an empty body even without one, and Better Auth refuses a body with no content type.
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = Data("{}".utf8)
            Task { _ = try? await APIClient.session.data(for: request) }
        }
        session?.end()
    }

    /// The session belongs to `id`. Any other previous owner is another user, whose rows, images, and names neither
    /// stay nor upload.
    func adopt(_ id: String) async {
        if store.me != id { await switchUser(to: id) }
    }

    /// The previous user's commits still on their way to the database are written first, so none lands after the
    /// clear. The store becomes `id`'s only once the clear worked: a database still holding the previous user's rows
    /// would show them as a space shared with `id` and upload their queue under `id`'s session.
    private func switchUser(to id: String) async {
        try? await ready.value
        await store.saved()
        var delay = Duration.seconds(1)
        while true {
            do {
                try await database.powerSync.disconnectAndClear()
                break
            } catch {
                ErrorReport.log("Could not clear the previous user's data", error: error)
                try? await Task.sleep(for: delay)
                delay = min(delay * 2, .seconds(30))
            }
        }
        DeviceDefaults.forgetDatabaseID()
        store.switchUser(to: id)
        store.noteTimeZone(clock.timeZone.identifier)
        rows = LocalRows(me: id)
        cursor = nil
        loaded = false
        unreadable = false
        reload()
        askedForPeople = []
        TaskImages.clearLocal()
    }

    private func reject() {
        session?.end()
    }

    private func rejected(_ rows: [(kind: EntityKind, id: String)]) {
        let shown = Snapshot(
            tasks: store.allTasks, projects: store.allProjects, sections: store.allSections, labels: store.allLabels,
            settings: store.snapshot.settings
        )
        if let notice = Rows.rejectionNotice(shown, rows) { toasts?.show(notice) }
    }

    #if DEBUG
    /// Writes another user's space straight into the local database, unless an earlier launch did, and shows it with
    /// the `access` rows the server would add, for the DEBUG demos that show sharing without a second account.
    func seed(space owner: String, _ data: Snapshot, access: [Access]) async {
        demoAccess = access
        do {
            try await ready.value
            if store.spaces[owner] == nil {
                try await database.write(RowBatch(version: 0, owner: owner, writes: Rows.rowWrites(.empty, data)))
            }
        } catch {
            ErrorReport.log("Could not seed the demo space", error: error)
        }
        await reloadNow()
    }
    #endif

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

enum DeviceDefaults {
    private static let peopleKey = "procrastimate-people"
    private static let installKey = "procrastimate-install-id"
    private static let databaseKey = "procrastimate-database"

    /// The people cache, so names show offline.
    static var people: [Person] {
        get {
            UserDefaults.standard.data(forKey: peopleKey).flatMap { try? JSONDecoder().decode([Person].self, from: $0) } ?? []
        }
        set { UserDefaults.standard.set(try? JSONEncoder().encode(newValue), forKey: peopleKey) }
    }

    /// This install's id, which Ramble names the device by. Created on first use.
    static var installID: String {
        if let id = UserDefaults.standard.string(forKey: installKey) { return id }
        let id = UUID().uuidString.lowercased()
        UserDefaults.standard.set(id, forKey: installKey)
        return id
    }

    /// Names this local database, so an upload's op ids (`<database>:<queue id>`) never repeat. PowerSync's queue ids
    /// can restart when the database is cleared, so a cleared database gets a new name.
    static var databaseID: String {
        if let id = UserDefaults.standard.string(forKey: databaseKey) { return id }
        let id = UUID().uuidString.lowercased()
        UserDefaults.standard.set(id, forKey: databaseKey)
        return id
    }

    static func forgetDatabaseID() { UserDefaults.standard.removeObject(forKey: databaseKey) }
}
