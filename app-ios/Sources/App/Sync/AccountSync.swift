import Core
import Foundation
import Observation
import UIKit

@MainActor @Observable
final class AccountSync {
    private let store: Store
    private let clock: AppClock
    private let session: Session
    private var task: Task<Void, Never>?
    private var soon: Task<Void, Never>?
    private var socket: URLSessionWebSocketTask?
    private var spacesListedAt: ContinuousClock.Instant?
    private static let spacesInterval = Duration.seconds(300)

    init(store: Store, clock: AppClock, session: Session) {
        self.store = store
        self.clock = clock
        self.session = session
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
            Task { _ = try? await URLSession.shared.data(for: request) }
        }
        SessionToken.clear()
        session.signedIn = Launch.signedIn
    }

    func deleteAccount() async {
        stop()
        guard let token = SessionToken.read() else { return }
        do {
            _ = try await APIClient.send(API.Endpoints.AccountDelete.self, NoInput(), token: token)
        } catch {
            session.error = ErrorReport("Could not delete the account", error: error)
            start()
            return
        }
        store.switchUser()
        UserDefaults.standard.removeObject(forKey: Session.ownerKey)
        SessionToken.clear()
        session.signedIn = Launch.signedIn
    }

    /// The user's own space first, then the list of spaces shared with them when it is due, then each shared space.
    private func sync() async {
        guard let token = SessionToken.read() else { return }
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
            print("sync: the outbox does not fit the contract", error)
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
            ErrorReport.log("Sync failed for \(space.query ?? "own space")", detail: String(reflecting: error))
            return false
        }
        let applied = switch space {
        case .own: store.takeSyncResponse(response)
        case let .shared(id): store.takeSyncResponse(response, space: id)
        }
        if applied, case let .changes(page) = response, page.changes.count >= SyncEngine.pageSize {
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
            ErrorReport.log("Could not list shared spaces", detail: String(reflecting: error))
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
        let task = URLSession.shared.webSocketTask(with: request)
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

    static func clear() {
        SharedSession.delete()
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
        ]
        SecItemDelete(query as CFDictionary)
    }
}
