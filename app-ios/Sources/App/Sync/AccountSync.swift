import Core
import Foundation
import Observation
import UIKit

@MainActor @Observable
final class AccountSync {
    private let store: Store
    private let clock: AppClock
    private let session: Session
    private let images: TaskImages
    private let toasts: Toasts
    private var task: Task<Void, Never>?
    private var soon: Task<Void, Never>?
    private var socket: URLSessionWebSocketTask?
    private var spacesListedAt: ContinuousClock.Instant?
    private static let spacesInterval = Duration.seconds(300)

    init(store: Store, clock: AppClock, session: Session, images: TaskImages, toasts: Toasts) {
        self.store = store
        self.clock = clock
        self.session = session
        self.images = images
        self.toasts = toasts
        let device = store.snapshot.sync.map { ($0.deviceId, Self.deviceName()) }
        APIClient.device.withLock { $0 = device }
    }

    /// Syncs while a real session token is in the Keychain. The DEBUG launch flag is not a token.
    func start() {
        guard SessionToken.read() != nil else { return }
        task?.cancel()
        task = Task {
            await sync()
            connect()
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(60))
                await sync()
            }
        }
    }

    func stop() {
        task?.cancel()
        task = nil
        soon?.cancel()
        soon = nil
        disconnect()
    }

    func syncNow() {
        soon?.cancel()
        Task { await sync() }
    }

    /// Uploads this install's pending edits now, for a request the server can only answer once it has them.
    func flush() async {
        soon?.cancel()
        await sync()
    }

    /// Pull to refresh: a full round now, the shared spaces list included, then the socket again if it dropped.
    func refresh() async {
        soon?.cancel()
        spacesListedAt = nil
        await sync()
        connect()
    }

    /// Syncs one second after a local edit, so a burst is one request.
    func syncSoon() {
        soon?.cancel()
        soon = Task {
            try? await Task.sleep(for: .seconds(1))
            guard !Task.isCancelled else { return }
            await sync()
        }
    }

    func signOut() {
        stop()
        if let token = SessionToken.read() {
            var request = URLRequest(url: AppEnvironment.apiURL.appending(path: "api/auth/sign-out"))
            request.httpMethod = "POST"
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            Task { _ = try? await APIClient.session.data(for: request) }
        }
        SessionToken.clear()
        session.signedIn = Launch.signedIn
    }

    /// Not optimistic: it cannot be undone, so the account stays until the server confirms. False when it refused.
    func deleteAccount() async -> Bool {
        stop()
        guard let token = SessionToken.read() else { return false }
        do {
            _ = try await APIClient.send(API.Endpoints.AccountDelete.self, NoInput(), token: token)
        } catch {
            _ = ErrorReport("Could not delete the account", error: error)
            start()
            return false
        }
        store.switchUser()
        TaskImages.clearLocal()
        for key in [Session.ownerKey, Session.ownerEmailKey, Session.ownerNameKey] {
            UserDefaults.standard.removeObject(forKey: key)
        }
        SessionToken.clear()
        session.signedIn = Launch.signedIn
        return true
    }

    /// The user's own space first, then the list of spaces shared with them when it is due, then each shared space.
    private func sync() async {
        guard let token = SessionToken.read() else { return }
        await Telemetry.trace("Sync", operation: "sync.cycle", bindToScope: true) {
            store.noteTimeZone(clock.timeZone.identifier)
            let device = device()
            APIClient.device.withLock { $0 = device }
            guard await syncSpace(.own, token: token) else { return }
            if spacesListedAt.map({ $0.duration(to: .now) > Self.spacesInterval }) ?? true {
                await listSpaces(token: token)
            }
            for (id, _) in store.sharedSpaces {
                await syncSpace(.shared(id), token: token)
            }
        }
    }

    /// One round of the sync protocol for a space, repeated while pages come back full. A shared space that answers
    /// `403` is no longer shared, so its section goes.
    @discardableResult
    private func syncSpace(_ space: SpaceKey, token: String) async -> Bool {
        let body: API.SyncRequest
        do {
            let request = switch space {
            case .own: try store.syncRequest()
            case let .shared(id): try store.syncRequest(space: id)
            }
            guard let request else { return false }
            body = request
        } catch {
            ErrorReport.log("The sync request does not fit the contract", error: error)
            return false
        }
        // Built before the uploads, so every edit it carries was recorded after its image was queued, and the edits that
        // list a new image go out only after its bytes.
        do {
            try await images.upload(space, token: token)
        } catch {
            ErrorReport.log("Image upload failed", about: space.query ?? "own space", error: error)
            return false
        }
        let response: API.SyncResponse
        do {
            response = try await APIClient.send(
                API.Endpoints.Sync.self, body, query: ["space": space.query], token: token, device: device()
            )
        } catch let failure as APIFailure where failure.isUnauthorized {
            reject()
            return false
        } catch let failure as APIFailure where failure.isForbidden {
            if let id = space.query { store.dropSpace(id) }
            return false
        } catch {
            ErrorReport.log("Sync failed", about: space.query ?? "own space", error: error)
            return false
        }
        let seeding = space == .own && store.snapshot.sync?.seed == true
        let taken = switch space {
        case .own: store.takeSyncResponse(response)
        case let .shared(id): store.takeSyncResponse(response, space: id)
        }
        if let notice = taken?.notice { toasts.show(notice) }
        let applied = taken != nil
        if applied, case let .changes(page) = response, page.changes.count >= SyncEngine.pageSize {
            return await syncSpace(space, token: token)
        }
        // The first snapshot queued what this install adds to the account, which goes up right away.
        if applied, seeding, store.snapshot.sync?.seed == false, store.snapshot.sync?.outbox.isEmpty == false {
            return await syncSpace(space, token: token)
        }
        return applied
    }

    private func listSpaces(token: String) async {
        do {
            let listed = try await APIClient.send(API.Endpoints.SpacesList.self, NoInput(), token: token)
            spacesListedAt = .now
            store.setSpaces(listed.spaces)
        } catch {
            ErrorReport.log("Could not list shared spaces", error: error)
        }
    }

    /// A nudge for a space this device does not know yet means it was just shared, so the list comes first.
    private func nudged(_ nudge: API.Nudge) async {
        guard let space = nudge.space else {
            if let own = store.snapshot.sync?.cursor, nudge.cursor > own { await sync() }
            return
        }
        guard let token = SessionToken.read() else { return }
        if store.snapshot.spaces[space] == nil { await listSpaces(token: token) }
        if store.snapshot.spaces[space] != nil { await syncSpace(.shared(space), token: token) }
    }

    private func connect() {
        guard socket == nil, let token = SessionToken.read() else { return }
        var components = URLComponents(url: AppEnvironment.apiURL.appending(path: "api/sync/socket"), resolvingAgainstBaseURL: false)
        components?.scheme = AppEnvironment.apiURL.scheme == "https" ? "wss" : "ws"
        guard let url = components?.url else { return }
        var request = URLRequest(url: url)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        applyDevice(&request)
        let task = APIClient.session.webSocketTask(with: request)
        socket = task
        task.resume()
        listen(task)
    }

    private func listen(_ task: URLSessionWebSocketTask) {
        task.receive { [weak self] result in
            Task { @MainActor in
                guard let self, self.socket === task else { return }
                if case let .success(.string(text)) = result,
                   let nudge = try? JSONDecoder.validating().decode(API.Nudge.self, from: Data(text.utf8)) {
                    await self.nudged(nudge)
                }
                if case .failure = result {
                    self.disconnect()
                    return
                }
                self.listen(task)
            }
        }
    }

    private func disconnect() {
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
    }

    private func reject() {
        stop()
        SessionToken.clear()
        session.signedIn = Launch.signedIn
    }

    private func device() -> (id: String, name: String)? {
        store.snapshot.sync.map { ($0.deviceId, Self.deviceName()) }
    }

    private func applyDevice(_ request: inout URLRequest) {
        guard let (id, name) = device() else { return }
        request.setValue(id, forHTTPHeaderField: "x-procrastimate-device")
        request.setValue(name, forHTTPHeaderField: "x-procrastimate-device-name")
    }

    private static func deviceName() -> String {
        #if os(iOS)
        UIDevice.current.userInterfaceIdiom == .pad ? "iPad" : "iPhone"
        #else
        "iPhone"
        #endif
    }
}

/// The Better Auth bearer token. It is the credential; the device id in the snapshot is not.
enum SessionToken {
    private static let service = "procrastimate-session"

    static func read() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func write(_ token: String) {
        clear()
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecValueData as String: Data(token.utf8),
        ]
        SecItemAdd(query as CFDictionary, nil)
        SharedSession.write(token: token)
    }

    /// Every way out of an account (sign-out, a rejected token, deletion) ends here.
    static func clear() {
        Telemetry.signedOut()
        SharedSession.delete()
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
        ]
        SecItemDelete(query as CFDictionary)
    }
}
