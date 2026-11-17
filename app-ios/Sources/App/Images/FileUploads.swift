import Core
import Foundation
import UIKit

/// Uploads queued files in the background, one at a time: whole when a file fits one part, else as a multipart upload,
/// a few parts at once, which resumes from the parts the server already holds. A sync never waits on it, so the task
/// lists a file before its bytes arrive, and another device opens it once they have. It runs when a file is queued and
/// when the app comes forward, and again on a growing delay after a failure.
actor FileUploads {
    static let shared = FileUploads()
    /// Posted with `id`, and `sent` in bytes while the upload runs; without `sent` once the server has the file.
    static let progressed = Notification.Name("FileUploads.progressed")

    private static let parallelParts = 3
    private var running = false
    private var again = false
    private var delay = Duration.seconds(5)

    private struct Restart: Error {}
    /// The server refused the upload for good, so it leaves the queue.
    private struct Refused: Error {}

    nonisolated func kick() {
        Task { await drain() }
    }

    private func drain() async {
        if running {
            again = true
            return
        }
        guard let token = SessionToken.read() else { return }
        running = true
        defer { running = false }
        // Lets a part in flight finish after the app leaves the screen.
        let background = await MainActor.run { UIApplication.shared.beginBackgroundTask() }
        defer { Task { @MainActor in UIApplication.shared.endBackgroundTask(background) } }
        do {
            repeat {
                again = false
                for queued in AttachmentFiles.queuedFiles() {
                    do {
                        try await upload(queued, token: token)
                    } catch is Restart {
                        again = true
                    }
                }
            } while again
            delay = .seconds(5)
        } catch {
            let wait = delay
            delay = min(delay * 2, .seconds(60))
            Task {
                try? await Task.sleep(for: wait)
                await drain()
            }
        }
    }

    private func upload(_ queued: AttachmentFiles.Queued, token: String) async throws {
        var queued = queued
        let size = (try queued.file.resourceValues(forKeys: [.fileSizeKey])).fileSize ?? 0
        if size <= FileKinds.partBytes, queued.upload.multipart == nil {
            let request = Self.request(queued, token: token, method: "PUT")
            let (_, response) = try await APIClient.session.upload(for: request, fromFile: queued.file)
            try Self.settled(response)
        } else {
            do {
                try await uploadParts(&queued, size: size, token: token)
            } catch is Refused {}
        }
        AttachmentFiles.uploaded(queued)
        NotificationCenter.default.post(name: Self.progressed, object: nil, userInfo: ["id": queued.id])
    }

    private func uploadParts(_ queued: inout AttachmentFiles.Queued, size: Int, token: String) async throws {
        if queued.upload.multipart == nil {
            let (data, response) = try await APIClient.session.data(for: Self.request(queued, token: token, method: "POST"))
            guard try Self.settled(response) else { return }
            guard let begun = try JSONDecoder().decode(API.UploadBegun.self, from: data).upload else { return }
            queued.upload.multipart = begun
            queued.upload.etags = Array(repeating: nil, count: FileKinds.partCount(size))
            try AttachmentFiles.save(queued)
        }
        guard let multipart = queued.upload.multipart else { return }
        let report = { [queued] (etags: [String?]) in
            let sent = min(etags.compactMap(\.self).count * FileKinds.partBytes, size)
            NotificationCenter.default.post(name: Self.progressed, object: nil, userInfo: ["id": queued.id, "sent": sent])
        }
        report(queued.upload.etags)
        var missing = queued.upload.etags.indices.filter { queued.upload.etags[$0] == nil }[...]
        let sending = queued
        try await withThrowingTaskGroup(of: (Int, String?).self) { group in
            let next = { (group: inout ThrowingTaskGroup<(Int, String?), any Error>) in
                guard let index = missing.popFirst() else { return }
                group.addTask { try await (index, Self.putPart(sending, index, multipart: multipart, token: token)) }
            }
            for _ in 0 ..< Self.parallelParts { next(&group) }
            for try await (index, etag) in group {
                guard let etag else {
                    group.cancelAll()
                    try forget(&queued)
                    throw Restart()
                }
                queued.upload.etags[index] = etag
                try AttachmentFiles.save(queued)
                report(queued.upload.etags)
                next(&group)
            }
        }
        var request = Self.request(queued, token: token, method: "POST", [URLQueryItem(name: "upload", value: multipart)])
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let parts = try JSONEncoder().encode(API.UploadCompletion(parts: queued.upload.etags.compactMap(\.self)))
        let (_, response) = try await APIClient.session.upload(for: request, from: parts)
        if (response as? HTTPURLResponse)?.statusCode == 404 {
            try forget(&queued)
            throw Restart()
        }
        try Self.settled(response)
    }

    /// The server no longer knows the upload, as after a week idle, so it begins again.
    private func forget(_ queued: inout AttachmentFiles.Queued) throws {
        queued.upload.multipart = nil
        queued.upload.etags = []
        try AttachmentFiles.save(queued)
    }

    /// One part's etag, or nil when the server does not know the upload.
    private nonisolated static func putPart(_ queued: AttachmentFiles.Queued, _ index: Int, multipart: String, token: String) async throws -> String? {
        let handle = try FileHandle(forReadingFrom: queued.file)
        defer { try? handle.close() }
        try handle.seek(toOffset: UInt64(index * FileKinds.partBytes))
        let bytes = try handle.read(upToCount: FileKinds.partBytes) ?? Data()
        let request = request(queued, token: token, method: "PUT", [
            URLQueryItem(name: "upload", value: multipart),
            URLQueryItem(name: "part", value: String(index + 1)),
        ])
        let (data, response) = try await APIClient.session.upload(for: request, from: bytes)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if status == 404 { return nil }
        if TaskAttachments.permanent.contains(status) { throw Refused() }
        guard (200 ..< 300).contains(status) else { throw APIFailure.status(status, nil) }
        return try JSONDecoder().decode(API.UploadedPart.self, from: data).etag
    }

    private nonisolated static func request(
        _ queued: AttachmentFiles.Queued,
        token: String,
        method: String,
        _ extra: [URLQueryItem] = []
    ) -> URLRequest {
        let declared = [URLQueryItem(name: "name", value: queued.upload.name), URLQueryItem(name: "type", value: queued.upload.type)]
        var request = URLRequest(url: AttachmentFiles.url(queued.id, "file", space: queued.space, declared + extra))
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
        return request
    }

    /// True when the server took the request, false when it refused it for good, which drops the upload. Throws for
    /// anything a retry might fix.
    @discardableResult
    private nonisolated static func settled(_ response: URLResponse) throws -> Bool {
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if (200 ..< 300).contains(status) { return true }
        guard TaskAttachments.permanent.contains(status) else { throw APIFailure.status(status, nil) }
        return false
    }
}
