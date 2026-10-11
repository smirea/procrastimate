import Core
import Foundation
import Observation

/// `Import from Todoist`: unzips a backup on the device, reads it with `Core`'s Todoist reader, and merges it into the
/// store in one command. Nothing is uploaded. Settings shows the outcome, whether the zip came from the file picker or
/// was opened into the app.
@MainActor @Observable
final class TodoistImport {
    enum Status: Equatable {
        case idle
        case done(Todoist.Summary)
        case failed(String)
    }

    private(set) var status: Status = .idle

    @ObservationIgnored private let store: Store
    @ObservationIgnored private let clock: AppClock

    init(store: Store, clock: AppClock) {
        self.store = store
        self.clock = clock
    }

    func run(_ url: URL) {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        guard let archive = try? Data(contentsOf: url) else {
            status = .failed("Couldn’t open this file.")
            return
        }
        guard let entries = try? ZipReader.entries(of: archive, include: { $0.lowercased().hasSuffix(".csv") }) else {
            status = .failed("This is not a Todoist backup zip.")
            return
        }
        let files = entries.map { Todoist.BackupFile(name: $0.name, text: String(decoding: $0.data, as: UTF8.self)) }
        let backup = Todoist.readTodoistBackup(files, clock.now, in: clock.timeZone)
        status = backup.projects.isEmpty
            ? .failed("No Todoist projects in this file.")
            : .done(store.importTodoist(backup))
    }

    func failed(_ message: String) {
        status = .failed(message)
    }
}
