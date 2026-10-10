import Foundation

/// Where the app keeps its data: one JSON snapshot in Application Support, plus `UserDefaults` for device preferences.
enum StoreLocation {
    static var directory: URL {
        URL.applicationSupportDirectory.appending(path: "procrastimate", directoryHint: .isDirectory)
    }

    static var snapshot: URL { directory.appending(path: "store.json") }

    /// Deletes every task and preference, so the app starts like a fresh install.
    static func reset() {
        do {
            try FileManager.default.removeItem(at: directory)
        } catch CocoaError.fileNoSuchFile {
        } catch {
            fatalError("Could not reset the store: \(error)")
        }
        if let domain = Bundle.main.bundleIdentifier {
            UserDefaults.standard.removePersistentDomain(forName: domain)
        }
    }
}
