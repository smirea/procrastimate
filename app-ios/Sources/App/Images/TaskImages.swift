import Core
import Foundation
import Observation
import UIKit

/// Task images on iOS, as on the web: a task's `images` field syncs like any other and the bytes stay out of it.
/// Attaching writes the new image's bytes to the upload queue and the cache before the edit is recorded, and every upload
/// drains that queue before PowerSync sends the edits, so the server never hears of an image it cannot serve. See
/// `docs/decisions/images.md`.
@MainActor @Observable
final class TaskImages {
    enum Size: String { case full, thumb }

    struct Viewing: Identifiable, Hashable {
        let taskID: String
        let imageID: String
        var id: String { imageID }
    }

    private(set) var loaded: [String: UIImage] = [:]
    /// How many images each task is still encoding, so details can show where they will land.
    private(set) var adding: [String: Int] = [:]
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

    func image(_ id: String, _ size: Size) -> UIImage? { loaded[Self.key(id, size)] }

    /// Reads an image from the cache or the server. False when the server does not have it yet, so the caller asks again.
    @discardableResult
    func load(_ id: String, _ size: Size, space: SpaceKey) async -> Bool {
        let key = Self.key(id, size)
        if loaded[key] != nil { return true }
        guard !loading.contains(key) else { return false }
        loading.insert(key)
        defer { loading.remove(key) }
        if let data = try? Data(contentsOf: Files.cached(key)), let image = UIImage(data: data) {
            loaded[key] = image
            return true
        }
        guard let data = try? await Self.fetch(id, size, space: space), let image = UIImage(data: data) else { return false }
        loaded[key] = image
        try? Files.write(data, to: Files.cached(key))
        return true
    }

    func attach(_ taskID: String, _ sources: [Data]) async {
        guard let space = store.space(ofTask: taskID) else { return }
        for source in sources {
            adding[taskID, default: 0] += 1
            defer { adding[taskID, default: 1] -= 1 }
            do {
                let encoded = try await Task.detached(priority: .userInitiated) { try ImageEncoder.encode(source) }.value
                let id = UUID().uuidString.lowercased()
                for (size, data) in [(Size.full, encoded.full), (.thumb, encoded.thumb)] {
                    let key = Self.key(id, size)
                    try Files.write(data, to: Files.cached(key))
                    try Files.write(data, to: Files.pending(space, key))
                    loaded[key] = UIImage(data: data)
                }
                guard let task = store.task(taskID) else { continue }
                let images = task.images + [ImageRef(id: id, width: encoded.width, height: encoded.height)]
                store.updateTask(taskID, TaskPatch(images: images))
            } catch {
                toasts.show("Could not attach that image")
            }
        }
    }

    func remove(_ taskID: String, _ imageID: String) {
        guard let task = store.task(taskID), let index = task.images.firstIndex(where: { $0.id == imageID }) else { return }
        let removed = task.images[index]
        store.updateTask(taskID, TaskPatch(images: task.images.filter { $0.id != imageID }))
        if viewing?.imageID == imageID { viewing = nil }
        toasts.show("Deleted image", undo: .image(.init(taskId: taskID, image: removed, index: index)), in: store)
    }

    /// Uploads every queued image, before PowerSync uploads the edits that list them. Throws when the server cannot be
    /// reached, so the upload waits too; an upload the server refuses for good is dropped instead of blocking it.
    nonisolated static func uploadQueued(token: String) async throws {
        for (space, file) in Files.queued() {
            let name = file.lastPathComponent
            guard let separator = name.lastIndex(of: "-"), let size = Size(rawValue: String(name[name.index(after: separator)...])) else {
                try? FileManager.default.removeItem(at: file)
                continue
            }
            // A failed read, as while the device is locked, stops the upload and keeps the only copy.
            let data = try Data(contentsOf: file)
            var request = URLRequest(url: Self.url(String(name[..<separator]), size, space: space))
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
        try? FileManager.default.removeItem(at: Files.cache)
        try? FileManager.default.removeItem(at: Files.queue)
    }

    #if DEBUG
    /// Writes a full and a thumbnail JPEG for `id` into the cache, for `PerfDemo`.
    nonisolated static func seedCached(_ id: String, hue: Double) {
        for (size, edge) in [(Size.full, 2048.0), (.thumb, 320.0)] {
            let url = Files.cached(key(id, size))
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

    private nonisolated static func key(_ id: String, _ size: Size) -> String { "\(id)-\(size.rawValue)" }

    private nonisolated static func url(_ id: String, _ size: Size, space: SpaceKey) -> URL {
        var items = [URLQueryItem(name: "id", value: id), URLQueryItem(name: "size", value: size.rawValue)]
        if let owner = space.query { items.append(URLQueryItem(name: "space", value: owner)) }
        return AppEnvironment.apiURL.appending(path: "api/images").appending(queryItems: items)
    }

    private static func fetch(_ id: String, _ size: Size, space: SpaceKey) async throws -> Data? {
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
