import Foundation
import OSLog
import Security

/// ProcrastiMate's session, shared with Stefan's voice memo app through the team's keychain access group, so that app
/// can send tasks as its own device. It mirrors `SessionToken`: written while signed in, deleted on sign-out or a 401.
/// The memo app processes with the screen locked, so the item is readable after first unlock. See
/// `docs/decisions/integrations.md`.
enum SharedSession {
    private static let log = Logger(subsystem: "com.stefan.procrastimate", category: "procrastimate-link")

    private static var query: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "procrastimate-link",
            kSecAttrAccount as String: "default",
            kSecAttrAccessGroup as String: "FNYFHG5SV7.com.stefan.shared",
        ]
    }

    static func write(token: String) {
        let link = ["apiURL": AppEnvironment.apiURL.absoluteString, "token": token]
        guard let data = try? JSONSerialization.data(withJSONObject: link, options: .sortedKeys) else { return }
        SecItemDelete(query as CFDictionary)
        var item = query
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        let status = SecItemAdd(item as CFDictionary, nil)
        log.notice("wrote \(AppEnvironment.apiURL.absoluteString, privacy: .public), status \(status)")
    }

    static func delete() {
        let status = SecItemDelete(query as CFDictionary)
        log.notice("deleted, status \(status)")
    }
}
