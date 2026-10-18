import Foundation
import Security

/// The Better Auth bearer token. It is the credential every request carries.
enum SessionToken {
    private static let service = "procrastimate-session"
    /// The id of the user the token belongs to. The Keychain outlives a reinstall while `UserDefaults` does not, so
    /// keeping the id beside the token lets a reinstalled app know whose empty database it opens before the network
    /// answers.
    private static let userService = "procrastimate-session-user"

    static func read() -> String? { item(service) }

    /// The user the token belongs to, once a session check has named them.
    static func user() -> String? { item(userService) }

    static func remember(user id: String) {
        delete(userService)
        add(userService, id)
    }

    static func write(_ token: String) {
        clear()
        add(service, token)
        SharedSession.write(token: token)
    }

    private static func item(_ service: String) -> String? {
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

    private static func add(_ service: String, _ value: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecValueData as String: Data(value.utf8),
        ]
        SecItemAdd(query as CFDictionary, nil)
    }

    private static func delete(_ service: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
        ]
        SecItemDelete(query as CFDictionary)
    }

    /// Every way out of an account (sign-out or a rejected token) ends here.
    static func clear() {
        Telemetry.signedOut()
        SharedSession.delete()
        delete(service)
        delete(userService)
    }
}
