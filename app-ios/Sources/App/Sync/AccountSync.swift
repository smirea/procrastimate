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

    init(store: Store, clock: AppClock, session: Session) {
        self.store = store
        self.clock = clock
        self.session = session
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

    private func sync() async {
        guard let token = SessionToken.read() else { return }
        store.noteTimeZone(clock.timeZone.identifier)
        let body: API.SyncRequest
        do {
            guard let request = try store.syncRequest() else { return }
            body = request
        } catch {
            print("sync: the outbox does not fit the contract", error)
            return
        }
        let response: API.SyncResponse
        do {
            response = try await APIClient.send(API.Endpoints.Sync.self, body, token: token, device: device())
        } catch let failure as APIFailure where failure.isUnauthorized {
            reject()
            return
        } catch {
            return
        }
        if store.takeSyncResponse(response), case let .changes(page) = response, page.changes.count >= SyncEngine.pageSize {
            await sync()
        }
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
                   let nudge = try? JSONDecoder.validating().decode(API.Nudge.self, from: Data(text.utf8)),
                   let own = self.store.snapshot.sync?.cursor, nudge.cursor > own {
                    await self.sync()
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
        store.snapshot.sync.map { ($0.deviceId, deviceName()) }
    }

    private func applyDevice(_ request: inout URLRequest) {
        guard let (id, name) = device() else { return }
        request.setValue(id, forHTTPHeaderField: "x-procrastimate-device")
        request.setValue(name, forHTTPHeaderField: "x-procrastimate-device-name")
    }

    private func deviceName() -> String {
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
    }

    static func clear() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
        ]
        SecItemDelete(query as CFDictionary)
    }
}
