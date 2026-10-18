import Core
import Foundation

enum StoreLocation {
    static var directory: URL {
        URL.applicationSupportDirectory.appending(path: "procrastimate", directoryHint: .isDirectory)
    }

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
