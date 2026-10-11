import Core
import Foundation
import UIKit

/// Registers this install and keeps the local document in sync. Nothing about it is shown.
@MainActor
final class AccountSync {
    private let store: Store
    private let clock: AppClock
    private var task: Task<Void, Never>?
    private var soon: Task<Void, Never>?
    private var socket: URLSessionWebSocketTask?
    private var replaced = false

    init(store: Store, clock: AppClock) {
        self.store = store
        self.clock = clock
    }

    func start() {
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

    /// Syncs at once. Foreground and launch use this.
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

    private func sync() async {
        store.noteTimeZone(clock.timeZone.identifier)
        if DeviceToken.read() == nil { guard await register() else { return } }
        guard let token = DeviceToken.read(), let body = store.syncRequest() else { return }
        var request = URLRequest(url: AppEnvironment.apiURL.appending(path: "api/sync"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.httpBody = body
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            return
        }
        guard let http = response as? HTTPURLResponse else { return }
        if http.statusCode == 401 {
            guard !replaced else { return }
            replaced = true
            DeviceToken.clear()
            disconnect()
            if await register() { await sync() }
            return
        }
        guard http.statusCode == 200 else { return }
        replaced = false
        if store.takeSyncResponse(data),
           let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let changes = object["changes"] as? [Any], changes.count >= 1000 {
            await sync()
        }
    }

    private func register() async -> Bool {
        let deviceId = store.snapshot.sync?.deviceId ?? UUID().uuidString.lowercased()
        let token = UUID().uuidString.replacingOccurrences(of: "-", with: "") + UUID().uuidString.replacingOccurrences(of: "-", with: "")
        var request = URLRequest(url: AppEnvironment.apiURL.appending(path: "api/auth/register"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body: [String: String] = [
            "gate": InstallGate.value,
            "deviceId": deviceId,
            "token": token,
            "name": deviceName(),
        ]
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              let http = response as? HTTPURLResponse, http.statusCode == 200,
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let stored = object["deviceId"] as? String else { return false }
        DeviceToken.write(token)
        store.adoptDevice(stored)
        connect()
        return true
    }

    private func connect() {
        guard socket == nil, let token = DeviceToken.read() else { return }
        var components = URLComponents(url: AppEnvironment.apiURL.appending(path: "api/sync/socket"), resolvingAgainstBaseURL: false)
        components?.scheme = AppEnvironment.apiURL.scheme == "https" ? "wss" : "ws"
        guard let url = components?.url else { return }
        var request = URLRequest(url: url)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
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
                   let data = text.data(using: .utf8),
                   let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let cursor = object["cursor"] as? Int,
                   let own = self.store.snapshot.sync?.cursor, cursor > own {
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

    private func deviceName() -> String {
        #if os(iOS)
        UIDevice.current.userInterfaceIdiom == .pad ? "iPad" : "iPhone"
        #else
        "iPhone"
        #endif
    }
}

/// The bearer token, outside the snapshot document.
enum DeviceToken {
    private static let service = "procrastinate-device"

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
