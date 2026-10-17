import Core
import Foundation

enum StoreLocation {
    static var directory: URL {
        URL.applicationSupportDirectory.appending(path: "procrastimate", directoryHint: .isDirectory)
    }

    /// The stored document, the same JSON as the web's `procrastimate` localStorage value.
    static var file: URL { directory.appending(path: "procrastimate.json") }

    /// The stored document's file, with each save timed and a failed one reported.
    static func snapshotFile() -> SnapshotFile {
        SnapshotFile(url: file) { save in
            do {
                try Telemetry.trace("Save store", operation: "store.save", save)
            } catch {
                ErrorReport.log("Could not save the store", error: error)
                throw error
            }
        }
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
