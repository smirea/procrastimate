import Core
import Foundation
import Observation
import UIKit

/// Task attachments on iOS, as on the web: a task's `attachments` field syncs like any other and the bytes stay out of
/// it. An attachment shows at once, from the bytes it was picked as; the task lists it once those bytes are in the
/// upload queue. Image sizes upload before sync-engine sends the edits that list them (its `beforePush`), so another
/// device never shows an image it cannot load; files upload in the background (`FileUploads`). See
/// `docs/decisions/images.md`.
@MainActor @Observable
final class TaskAttachments {
    enum Size: String { case full, thumb }

    struct Viewing: Identifiable, Hashable {
        let taskID: String
        let imageID: String
        var id: String { imageID }
    }

    private(set) var loaded: [String: UIImage] = [:]
    /// What each task is attaching, shown as tiles until the task lists it. An image not yet measured is 1 by 1.
    private(set) var adding: [String: [Attachment]] = [:]
    /// The bytes sent of each file still in the upload queue.
    private(set) var uploading: [String: Int] = [:]
    /// Files being downloaded to open.
    private(set) var opening: Set<String> = []
    var viewing: Viewing?

    @ObservationIgnored private let store: Store
    @ObservationIgnored private let toasts: Toasts
    @ObservationIgnored private var loading: Set<String> = []
    @ObservationIgnored private var progress: (any NSObjectProtocol)?

    /// How long a missing image waits before it is asked for again, as when another device has not uploaded it yet.
    static let retryMissing = Duration.seconds(30)
    /// The server answered for good: the request was bad, no longer allowed, or the bytes will never fit.
    nonisolated static let permanent: Set<Int> = [400, 403, 413, 415]

    init(store: Store, toasts: Toasts) {
        self.store = store
        self.toasts = toasts
        for id in AttachmentFiles.queuedFiles().map(\.id) { uploading[id] = 0 }
        progress = NotificationCenter.default.addObserver(forName: FileUploads.progressed, object: nil, queue: .main) { [weak self] note in
            guard let id = note.userInfo?["id"] as? String else { return }
            let sent = note.userInfo?["sent"] as? Int
            MainActor.assumeIsolated { self?.uploading[id] = sent }
        }
        FileUploads.shared.kick()
    }

    func image(_ id: String, _ size: Size) -> UIImage? { loaded[Self.key(id, size.rawValue)] }

    /// How far a long file's upload is, from 0 to 1, or nil once the server has it.
    func progress(_ file: FileRef) -> Double? {
        guard let sent = uploading[file.id], file.bytes > FileKinds.partBytes else { return nil }
        return Double(sent) / Double(file.bytes)
    }

    /// Reads an image from the cache or the server. False when the server does not have it yet, so the caller asks again.
    @discardableResult
    func load(_ id: String, _ size: Size, space: SpaceKey) async -> Bool {
        let key = Self.key(id, size.rawValue)
        if loaded[key] != nil { return true }
        guard !loading.contains(key) else { return false }
        loading.insert(key)
        defer { loading.remove(key) }
        if let data = try? Data(contentsOf: AttachmentFiles.cached(key)), let image = UIImage(data: data) {
            loaded[key] = image
            return true
        }
        guard let data = try? await Self.fetch(id, size.rawValue, space: space), let image = UIImage(data: data) else { return false }
        loaded[key] = image
        try? AttachmentFiles.write(data, to: AttachmentFiles.cached(key))
        return true
    }

    func attach(_ taskID: String, _ sources: [Data]) async {
        let picked = sources.map { (id: Self.newID(), data: $0) }
        adding[taskID, default: []] += picked.map { .image(ImageRef(id: $0.id, width: 1, height: 1)) }
        for (id, data) in picked {
            do {
                try await attachImage(taskID, id, data)
            } catch {
                toasts.show("Could not attach that image")
            }
            settle(taskID, id)
        }
    }

    /// Attaches picked files. One that encodes as an image becomes an image; anything else uploads as it is.
    func attach(_ taskID: String, files: [PickedFile]) async {
        let picked = files.map { (id: Self.newID(), file: $0) }
        adding[taskID, default: []] += picked.map { id, file in
            file.isImage ? .image(ImageRef(id: id, width: 1, height: 1)) : .file(Self.ref(id, file))
        }
        for (id, file) in picked {
            do {
                if file.isImage, let data = await Task.detached(priority: .userInitiated, operation: { file.data() }).value,
                   (try? await attachImage(taskID, id, data)) != nil
                {
                    settle(taskID, id)
                    continue
                }
                settle(taskID, id, as: .file(Self.ref(id, file)))
                try attachFile(taskID, id, file)
            } catch {
                toasts.show("Could not attach \(file.name)")
            }
            settle(taskID, id)
        }
    }

    /// Takes an attachment off `adding`, or swaps what it shows as.
    private func settle(_ taskID: String, _ id: String, as shown: Attachment? = nil) {
        let rest = (adding[taskID] ?? []).compactMap { $0.id == id ? shown : $0 }
        adding[taskID] = rest.isEmpty ? nil : rest
    }

    private func attachImage(_ taskID: String, _ id: String, _ source: Data) async throws {
        guard let space = store.space(ofTask: taskID) else { return }
        let thumb = Self.key(id, Size.thumb.rawValue)
        if let preview = await Task.detached(priority: .userInitiated, operation: { ImageEncoder.preview(source) }).value {
            loaded[thumb] = UIImage(cgImage: preview)
        }
        let encoded = try await Task.detached(priority: .userInitiated) { try ImageEncoder.encode(source) }.value
        for (size, data) in [(Size.full, encoded.full), (.thumb, encoded.thumb)] {
            let key = Self.key(id, size.rawValue)
            try AttachmentFiles.write(data, to: AttachmentFiles.cached(key))
            try AttachmentFiles.write(data, to: AttachmentFiles.pending(space, key))
            loaded[key] = UIImage(data: data)
        }
        guard let task = store.task(taskID) else { return }
        let attachments = task.attachments + [.image(ImageRef(id: id, width: encoded.width, height: encoded.height))]
        store.updateTask(taskID, TaskPatch(attachments: attachments))
    }

    private func attachFile(_ taskID: String, _ id: String, _ picked: PickedFile) throws {
        guard let space = store.space(ofTask: taskID) else { return }
        let file = Self.ref(id, picked)
        try AttachmentFiles.queue(picked.url, file, space: space)
        uploading[id] = 0
        guard let task = store.task(taskID) else { return }
        store.updateTask(taskID, TaskPatch(attachments: task.attachments + [.file(file)]))
        FileUploads.shared.kick()
    }

    private static func ref(_ id: String, _ picked: PickedFile) -> FileRef {
        // The schema caps a name at 255 UTF-16 units, as JavaScript counts a string's length.
        var name = picked.name.isEmpty ? "File" : picked.name
        while name.utf16.count > 255 { name.removeLast() }
        return FileRef(id: id, name: name, type: picked.type, bytes: picked.bytes)
    }

    /// The file under its own name for Quick Look: the copy on the device, as while it still waits to upload, or else
    /// downloaded from the server, straight to disk. Nil, with a toast, when the server does not have it yet.
    func open(_ file: FileRef, space: SpaceKey) async -> URL? {
        guard !opening.contains(file.id) else { return nil }
        opening.insert(file.id)
        defer { opening.remove(file.id) }
        let local = AttachmentFiles.cachedFile(file)
        if FileManager.default.fileExists(atPath: local.path) { return local }
        guard let token = SessionToken.read() else { return nil }
        var request = URLRequest(url: AttachmentFiles.url(file.id, "file", space: space))
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        do {
            let (downloaded, response) = try await APIClient.session.download(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else {
                toasts.show("\(file.name) has not finished uploading")
                return nil
            }
            try FileManager.default.createDirectory(at: local.deletingLastPathComponent(), withIntermediateDirectories: true)
            try FileManager.default.moveItem(at: downloaded, to: local)
            return local
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

    /// Uploads every queued image size, before sync-engine sends the edits that list them. Throws when the server cannot
    /// be reached, so the edits wait too; an upload the server refuses for good is dropped instead of blocking them.
    nonisolated static func uploadQueuedImages(token: String) async throws {
        for (space, file) in AttachmentFiles.queued() {
            let name = file.lastPathComponent
            guard let separator = name.lastIndex(of: "-") else {
                try? FileManager.default.removeItem(at: file)
                continue
            }
            let suffix = String(name[name.index(after: separator)...])
            if suffix.hasPrefix("file") { continue }
            guard Size(rawValue: suffix) != nil else {
                try? FileManager.default.removeItem(at: file)
                continue
            }
            // A failed read, as while the device is locked, stops the upload and keeps the only copy.
            let data = try Data(contentsOf: file)
            var request = URLRequest(url: AttachmentFiles.url(String(name[..<separator]), suffix, space: space))
            request.httpMethod = "PUT"
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            request.setValue("image/jpeg", forHTTPHeaderField: "Content-Type")
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
        try? FileManager.default.removeItem(at: AttachmentFiles.cache)
        try? FileManager.default.removeItem(at: AttachmentFiles.fileCache)
        try? FileManager.default.removeItem(at: AttachmentFiles.queue)
    }

    #if DEBUG
    /// Writes a full and a thumbnail JPEG for `id` into the cache, for `PerfDemo`.
    nonisolated static func seedCached(_ id: String, hue: Double) {
        for (size, edge) in [(Size.full, 2048.0), (.thumb, 320.0)] {
            let url = AttachmentFiles.cached(key(id, size.rawValue))
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
            if let data = image.jpegData(compressionQuality: 0.8) { try? AttachmentFiles.write(data, to: url) }
        }
    }
    #endif

    private nonisolated static func key(_ id: String, _ size: String) -> String { "\(id)-\(size)" }

    private static func newID() -> String { UUID().uuidString.lowercased() }

    private static func fetch(_ id: String, _ size: String, space: SpaceKey) async throws -> Data? {
        guard let token = SessionToken.read() else { return nil }
        var request = URLRequest(url: AttachmentFiles.url(id, size, space: space))
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await APIClient.session.data(for: request)
        return (response as? HTTPURLResponse)?.statusCode == 200 ? data : nil
    }
}

/// Where attachment bytes sit on the device. The caches can be purged by the system, since everything in them can be
/// fetched again. The queue cannot: it holds the only copy until the upload succeeds.
nonisolated enum AttachmentFiles {
    /// A file waiting to upload, with what its upload declares and how far a multipart upload got.
    struct Queued: Sendable {
        let space: SpaceKey
        let id: String
        let file: URL
        var upload: QueuedUpload
    }

    struct QueuedUpload: Codable, Sendable {
        var name: String
        var type: String
        /// The multipart upload the server began, and each part's etag once the server holds it.
        var multipart: String?
        var etags: [String?] = []
    }

    static var cache: URL { URL.cachesDirectory.appending(path: "procrastimate-images", directoryHint: .isDirectory) }
    static var fileCache: URL { URL.cachesDirectory.appending(path: "procrastimate-files", directoryHint: .isDirectory) }
    static var queue: URL { StoreLocation.directory.appending(path: "image-uploads", directoryHint: .isDirectory) }

    static func cached(_ key: String) -> URL { cache.appending(path: key) }

    /// A file under its own name, in a folder of its own, since Quick Look shows the name and reads the extension.
    static func cachedFile(_ file: FileRef) -> URL {
        let name = file.name.replacingOccurrences(of: "/", with: "-")
        return fileCache.appending(path: file.id, directoryHint: .isDirectory).appending(path: name.isEmpty ? "file" : name)
    }

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

    /// The queued files that are not image sizes, each with its upload's record.
    static func queuedFiles() -> [Queued] {
        queued().compactMap { space, file in
            let name = file.lastPathComponent
            guard name.hasSuffix("-file"),
                  let record = try? Data(contentsOf: file.appendingPathExtension("json")),
                  let upload = try? JSONDecoder().decode(QueuedUpload.self, from: record)
            else { return nil }
            return Queued(space: space, id: String(name.dropLast("-file".count)), file: file, upload: upload)
        }
    }

    /// Moves a picked file into the queue, with a second name for it in the cache so it opens before it uploads; the
    /// cache keeps the bytes once the upload takes the queue's name away.
    static func queue(_ picked: URL, _ file: FileRef, space: SpaceKey) throws {
        let queued = pending(space, "\(file.id)-file")
        try FileManager.default.createDirectory(at: queued.deletingLastPathComponent(), withIntermediateDirectories: true)
        try FileManager.default.moveItem(at: picked, to: queued)
        let shown = cachedFile(file)
        try? FileManager.default.createDirectory(at: shown.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? FileManager.default.linkItem(at: queued, to: shown)
        try save(Queued(space: space, id: file.id, file: queued, upload: QueuedUpload(name: file.name, type: file.type)))
    }

    static func save(_ queued: Queued) throws {
        try JSONEncoder().encode(queued.upload).write(to: queued.file.appendingPathExtension("json"), options: .atomic)
    }

    static func uploaded(_ queued: Queued) {
        try? FileManager.default.removeItem(at: queued.file)
        try? FileManager.default.removeItem(at: queued.file.appendingPathExtension("json"))
    }

    static func write(_ data: Data, to url: URL) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: url, options: .atomic)
    }

    static func url(_ id: String, _ size: String, space: SpaceKey, _ extra: [URLQueryItem] = []) -> URL {
        var items = [URLQueryItem(name: "id", value: id), URLQueryItem(name: "size", value: size)]
        if let owner = space.query { items.append(URLQueryItem(name: "space", value: owner)) }
        return AppEnvironment.apiURL.appending(path: "api/images").appending(queryItems: items + extra)
    }
}
