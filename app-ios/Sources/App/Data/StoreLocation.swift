import Foundation

/// The folder in Application Support that holds all local task data, whatever its format, plus `UserDefaults` for
/// device preferences.
enum StoreLocation {
    static var directory: URL {
        URL.applicationSupportDirectory.appending(path: "procrastimate", directoryHint: .isDirectory)
    }

    /// Deletes all local data and preferences, so the app starts like a fresh install.
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
