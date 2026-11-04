import Core
import Foundation
import Observation
import UIKit

/// Task attachments on iOS, as on the web: a task's `attachments` field syncs like any other and the bytes stay out of it.
/// Attaching writes the new image's sizes, or a file's parts, to the upload queue and the cache before the edit is
/// recorded, and every upload drains that queue before sync-engine sends the edits (its `beforePush`), so the server
/// never hears of an attachment it cannot serve. See `docs/decisions/images.md`.
@MainActor @Observable
final class TaskAttachments {
    enum Size: String { case full, thumb }

    struct Viewing: Identifiable, Hashable {
        let taskID: String
        let imageID: String
        var id: String { imageID }
    }

    private(set) var loaded: [String: UIImage] = [:]
    /// How many attachments each task is still preparing, so details can show where they will land.
    private(set) var adding: [String: Int] = [:]
    /// Files whose parts are being assembled to open.
    private(set) var opening: Set<String> = []
    var viewing: Viewing?

    @ObservationIgnored private let store: Store
    @ObservationIgnored private let toasts: Toasts
    @ObservationIgnored private var loading: Set<String> = []

    /// How long a missing image waits before it is asked for again, as when another device has not uploaded it yet.
    static let retryMissing = Duration.seconds(30)
    /// The server answered for good: the request was bad, no longer allowed, or the bytes will never fit.
    private nonisolated static let permanent: Set<Int> = [400, 403, 404, 413, 415]

    init(store: Store, toasts: Toasts) {
        self.store = store
        self.toasts = toasts
    }

    func image(_ id: String, _ size: Size) -> UIImage? { loaded[Self.key(id, size.rawValue)] }

    /// Reads an image from the cache or the server. False when the server does not have it yet, so the caller asks again.
    @discardableResult
    func load(_ id: String, _ size: Size, space: SpaceKey) async -> Bool {
        let key = Self.key(id, size.rawValue)
        if loaded[key] != nil { return true }
        guard !loading.contains(key) else { return false }
        loading.insert(key)
        defer { loading.remove(key) }
        if let data = try? Data(contentsOf: Files.cached(key)), let image = UIImage(data: data) {
            loaded[key] = image
            return true
        }
        guard let data = try? await Self.fetch(id, size.rawValue, space: space), let image = UIImage(data: data) else { return false }
        loaded[key] = image
        try? Files.write(data, to: Files.cached(key))
        return true
    }

    func attach(_ taskID: String, _ sources: [Data]) async {
        for source in sources {
            adding[taskID, default: 0] += 1
            defer { adding[taskID, default: 1] -= 1 }
            do {
                try await attachImage(taskID, source)
            } catch {
                toasts.show("Could not attach that image")
            }
        }
    }

    /// Attaches picked files. One that encodes as an image becomes an image; anything else is stored as parts.
    func attach(_ taskID: String, files: [PickedFile]) async {
        for picked in files {
            adding[taskID, default: 0] += 1
            defer { adding[taskID, default: 1] -= 1 }
            do {
                if picked.isImage, (try? await attachImage(taskID, picked.data)) != nil { continue }
                try await attachFile(taskID, picked)
            } catch {
                toasts.show("Could not attach \(picked.name)")
            }
        }
    }

    private func attachImage(_ taskID: String, _ source: Data) async throws {
        guard let space = store.space(ofTask: taskID) else { return }
        let encoded = try await Task.detached(priority: .userInitiated) { try ImageEncoder.encode(source) }.value
        let id = UUID().uuidString.lowercased()
        for (size, data) in [(Size.full, encoded.full), (.thumb, encoded.thumb)] {
            try Self.queue(data, Self.key(id, size.rawValue), space: space)
            loaded[Self.key(id, size.rawValue)] = UIImage(data: data)
        }
        guard let task = store.task(taskID) else { return }
        let attachments = task.attachments + [.image(ImageRef(id: id, width: encoded.width, height: encoded.height))]
        store.updateTask(taskID, TaskPatch(attachments: attachments))
    }

    private func attachFile(_ taskID: String, _ picked: PickedFile) async throws {
        guard let space = store.space(ofTask: taskID) else { return }
        let id = UUID().uuidString.lowercased()
        let data = picked.data
        try await Task.detached(priority: .userInitiated) {
            for part in 0 ..< FileKinds.partCount(data.count) {
                let start = part * FileKinds.partBytes
                let slice = data.subdata(in: start ..< min(start + FileKinds.partBytes, data.count))
                try TaskAttachments.queue(slice, TaskAttachments.partKey(id, part), space: space)
            }
        }.value
        guard let task = store.task(taskID) else { return }
        // The schema caps a name at 255 UTF-16 units, as JavaScript counts a string's length.
        var name = picked.name.isEmpty ? "File" : picked.name
        while name.utf16.count > 255 { name.removeLast() }
        let file = FileRef(id: id, name: name, type: picked.type, bytes: data.count)
        store.updateTask(taskID, TaskPatch(attachments: task.attachments + [.file(file)]))
    }

    /// Assembles a file's parts, from the cache or the server, into a temporary file under its own name for Quick Look.
    /// Nil, with a toast, when a part is missing, as while another device has not finished uploading it.
    func open(_ file: FileRef, space: SpaceKey) async -> URL? {
        guard !opening.contains(file.id) else { return nil }
        opening.insert(file.id)
        defer { opening.remove(file.id) }
        var data = Data(capacity: file.bytes)
        for part in 0 ..< FileKinds.partCount(file.bytes) {
            let key = Self.partKey(file.id, part)
            if let cached = try? Data(contentsOf: Files.cached(key)) {
                data.append(cached)
            } else if let fetched = try? await Self.fetch(file.id, "part\(part)", space: space) {
                try? Files.write(fetched, to: Files.cached(key))
                data.append(fetched)
            } else {
                break
            }
        }
        guard data.count == file.bytes else {
            toasts.show("\(file.name) has not finished uploading")
            return nil
        }
        let name = file.name.replacingOccurrences(of: "/", with: "-")
        let url = URL.temporaryDirectory.appending(path: "attachments/\(file.id)", directoryHint: .isDirectory)
            .appending(path: name.isEmpty ? "file" : name)
        do {
            try Files.write(data, to: url)
            return url
        } catch {
            toasts.show("Could not open \(file.name)")
            return nil
        }
    }

    func remove(_ taskID: String, _ attachmentID: String) {
        guard let task = store.task(taskID), let index = task.attachments.firstIndex(where: { $0.id == attachmentID }) else { return }
        let removed = task.attachments[index]
        store.updateTask(taskID, TaskPatch(attachments: task.attachments.filter { $0.id != attachmentID }))
        if viewing?.imageID == attachmentID { viewing = nil }
        let message = removed.file == nil ? "Deleted image" : "Deleted file"
        toasts.show(message, undo: .attachment(.init(taskId: taskID, attachment: removed, index: index)), in: store)
    }

    /// Uploads every queued image size and file part, before sync-engine sends the edits that list them. Throws when the server cannot be
    /// reached, so the upload waits too; an upload the server refuses for good is dropped instead of blocking it.
    nonisolated static func uploadQueued(token: String) async throws {
        for (space, file) in Files.queued() {
            let name = file.lastPathComponent
            guard let separator = name.lastIndex(of: "-"), let size = Self.sizeName(String(name[name.index(after: separator)...])) else {
                try? FileManager.default.removeItem(at: file)
                continue
            }
            // A failed read, as while the device is locked, stops the upload and keeps the only copy.
            let data = try Data(contentsOf: file)
            var request = URLRequest(url: Self.url(String(name[..<separator]), size, space: space))
            request.httpMethod = "PUT"
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            request.setValue(Size(rawValue: size) == nil ? FileKinds.partType : "image/jpeg", forHTTPHeaderField: "Content-Type")
            let (_, response) = try await APIClient.session.upload(for: request, from: data)
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            guard (200 ..< 300).contains(status) || Self.permanent.contains(status) else {
                throw APIFailure.status(status, nil)
            }
            try? FileManager.default.removeItem(at: file)
        }
    }

    /// For a different signed-in user: nothing of the previous one's stays or uploads. Ids never repeat, so the images
    /// already decoded in memory cannot show on the next user's tasks.
    nonisolated static func clearLocal() {
        try? FileManager.default.removeItem(at: Files.cache)
        try? FileManager.default.removeItem(at: Files.queue)
    }

    #if DEBUG
    /// Writes a full and a thumbnail JPEG for `id` into the cache, for `PerfDemo`.
    nonisolated static func seedCached(_ id: String, hue: Double) {
        for (size, edge) in [(Size.full, 2048.0), (.thumb, 320.0)] {
            let url = Files.cached(key(id, size.rawValue))
            guard !FileManager.default.fileExists(atPath: url.path) else { continue }
            let format = UIGraphicsImageRendererFormat()
            format.scale = 1
            let image = UIGraphicsImageRenderer(size: CGSize(width: edge, height: edge * 0.75), format: format).image { context in
                for band in 0 ..< 24 {
                    UIColor(hue: (hue + Double(band) / 48).truncatingRemainder(dividingBy: 1), saturation: 0.6, brightness: 0.9, alpha: 1)
                        .setFill()
                    context.fill(CGRect(x: 0, y: Double(band) * edge * 0.75 / 24, width: edge, height: edge * 0.75 / 24 + 1))
                }
            }
            if let data = image.jpegData(compressionQuality: 0.8) { try? Files.write(data, to: url) }
        }
    }
    #endif

    private nonisolated static func key(_ id: String, _ size: String) -> String { "\(id)-\(size)" }

    private nonisolated static func partKey(_ id: String, _ part: Int) -> String { key(id, "part\(part)") }

    /// The server's `size` for a queued file's suffix: an image's `full` or `thumb`, or a file's `part<n>`.
    private nonisolated static func sizeName(_ suffix: String) -> String? {
        if Size(rawValue: suffix) != nil { return suffix }
        guard suffix.hasPrefix("part"), let part = Int(suffix.dropFirst(4)), part >= 0 else { return nil }
        return suffix
    }

    private nonisolated static func queue(_ data: Data, _ key: String, space: SpaceKey) throws {
        try Files.write(data, to: Files.cached(key))
        try Files.write(data, to: Files.pending(space, key))
    }

    private nonisolated static func url(_ id: String, _ size: String, space: SpaceKey) -> URL {
        var items = [URLQueryItem(name: "id", value: id), URLQueryItem(name: "size", value: size)]
        if let owner = space.query { items.append(URLQueryItem(name: "space", value: owner)) }
        return AppEnvironment.apiURL.appending(path: "api/images").appending(queryItems: items)
    }

    private static func fetch(_ id: String, _ size: String, space: SpaceKey) async throws -> Data? {
        guard let token = SessionToken.read() else { return nil }
        var request = URLRequest(url: url(id, size, space: space))
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await APIClient.session.data(for: request)
        return (response as? HTTPURLResponse)?.statusCode == 200 ? data : nil
    }

    /// The cache can be purged by the system, since every image in it can be fetched again. The queue cannot: it holds
    /// the only copy until the upload succeeds.
    private nonisolated enum Files {
        static var cache: URL { URL.cachesDirectory.appending(path: "procrastimate-images", directoryHint: .isDirectory) }
        static var queue: URL { StoreLocation.directory.appending(path: "image-uploads", directoryHint: .isDirectory) }

        static func cached(_ key: String) -> URL { cache.appending(path: key) }

        static func folder(_ space: SpaceKey) -> URL { queue.appending(path: space.query ?? "own", directoryHint: .isDirectory) }

        static func pending(_ space: SpaceKey, _ key: String) -> URL { folder(space).appending(path: key) }

        /// Every queued file with the space it belongs to: `own`, or a shared space's owner id.
        static func queued() -> [(SpaceKey, URL)] {
            let folders = (try? FileManager.default.contentsOfDirectory(at: queue, includingPropertiesForKeys: nil)) ?? []
            return folders.flatMap { folder -> [(SpaceKey, URL)] in
                let name = folder.lastPathComponent
                let space: SpaceKey = name == "own" ? .own : .shared(name)
                let files = (try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? []
                return files.map { (space, $0) }
            }
        }

        static func write(_ data: Data, to url: URL) throws {
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try data.write(to: url, options: .atomic)
        }
    }
}
