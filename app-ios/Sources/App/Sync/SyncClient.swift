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
    @ObservationIgnored private let clock: AppClock
    @ObservationIgnored private let ready: Task<Void, any Error>
    @ObservationIgnored private let writes: AsyncStream<RowBatch>.Continuation
    @ObservationIgnored private var observation: AnyDatabaseCancellable?
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
        // A token without a known owner, as after a reinstall that kept the Keychain, leaves `me` nil: the store reads
        // nothing and writes nothing until the session check names the owner, so no row is filed under the wrong one.
        let me = Session.userID ?? (SessionToken.read() == nil ? Self.localOwner : nil)
        // The views exist from the last launch, so the first frame shows the data. A fresh file has none yet.
        let spaces = me.map { me in Spaces((try? database.pool.read(LocalDatabase.rows)) ?? StoredRows(), me: me) }
        store = Telemetry.trace("Load store", operation: "store.load") {
            Store(me: me, spaces: spaces ?? Spaces(), people: DeviceDefaults.people, clock: clock)
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
        guard let me = store.me else { return }
        var spaces = Spaces(rows, me: me)
        #if DEBUG
        spaces.access += demoAccess
        #endif
        store.reload(spaces)
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

    /// Whether this device knows whose database it holds, which sync and writes wait for when a token exists.
    var ownerPending: Bool { store.me == nil }

    /// Connects while a real session token is in the Keychain and its owner is known. The DEBUG launch flag is not a
    /// token. Until PowerSync reports the attempt, a second call joins it rather than connecting again.
    func start() {
        guard SessionToken.read() != nil, !Launch.offline, let me = store.me, me != Self.localOwner,
              connecting == nil else { return }
        connecting = Task { await connect() }
    }

    private func connect() async {
        do {
            try await ready.value
            try await database.powerSync.connect(
                connector: connector, options: ConnectOptions(crudThrottle: 0.2, retryDelay: 2)
            )
            connecting = nil
        } catch {
            connecting = nil
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

    func resume() {
        let status = database.powerSync.currentStatus
        guard !status.connected, !status.connecting else { return }
        start()
    }

    /// Pull to refresh: reconnects if needed and waits, up to five seconds, for the stream to catch up.
    func refresh() async {
        guard !Launch.offline else { return }
        if ownerPending { await session?.refresh() }
        guard !ownerPending else { return }
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
        guard !ownerPending else { return }
        await store.saved()
        await waitUntil(.seconds(10)) { _, pending in !pending }
    }

    /// Waits until the local database holds every commit made so far. While the owner is unknown, commits stay in
    /// memory, so this asks the server once (a background launch never ran `Session.start`) and returns if it can't
    /// answer.
    func saved() async {
        if ownerPending { await session?.refresh() }
        guard !ownerPending else { return }
        await store.saved()
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

    /// The session belongs to `id`. A device that did not know whose database it held keeps it, writes what it held
    /// as `id`'s, and connects. Any other previous owner is another user, whose rows, images, and names neither stay
    /// nor upload.
    func adopt(_ id: String) async {
        switch store.me {
        case id:
            return
        case nil:
            store.adopt(id)
            await reloadNow()
            start()
        default:
            await switchUser(to: id)
        }
    }

    private func switchUser(to id: String) async {
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
