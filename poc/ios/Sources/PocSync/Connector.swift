import Foundation
import PowerSync

public struct UploadOp: Codable, Sendable, Equatable {
	public var op: String
	public var type: String
	public var id: String
	public var data: JsonParam?

	public init(op: String, type: String, id: String, data: JsonParam?) {
		self.op = op
		self.type = type
		self.id = id
		self.data = data
	}
}

public actor UploadLog {
	public private(set) var ops: [UploadOp] = []
	public private(set) var rejected: [String] = []

	func record(_ ops: [UploadOp], rejected: [String]) {
		self.ops += ops
		self.rejected += rejected
	}
}

public enum PocError: Error {
	case http(String, Int, String)
}

/// `PowerSyncBackendConnector` is deprecated in 1.16; the SDK asks for a type conforming to the protocol instead.
public final class PocConnector: PowerSyncBackendConnectorProtocol {
	public let api: URL
	public let bearer: String
	public let uploads = UploadLog()

	public init(api: URL, bearer: String) {
		self.api = api
		self.bearer = bearer
	}

	public func fetchCredentials() async throws -> PowerSyncCredentials? {
		var request = URLRequest(url: api.appending(path: "api/auth/token"))
		request.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization")
		let (body, response) = try await URLSession.shared.data(for: request)
		try check(response, body, "token")
		struct Token: Decodable { let token: String }
		let token = try JSONDecoder().decode(Token.self, from: body).token
		return PowerSyncCredentials(endpoint: api.appending(path: "api/powersync").absoluteString, token: token)
	}

	public func uploadData(database: PowerSyncDatabaseProtocol) async throws {
		guard let batch = try await database.getCrudBatch(limit: 200) else { return }
		let ops = batch.crud.map { UploadOp(op: $0.op.rawValue, type: $0.table, id: $0.id, data: $0.opDataTyped) }
		var request = URLRequest(url: api.appending(path: "api/upload"))
		request.httpMethod = "POST"
		request.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization")
		request.setValue("application/json", forHTTPHeaderField: "Content-Type")
		request.httpBody = try JSONEncoder().encode(["batch": ops])
		let (body, response) = try await URLSession.shared.data(for: request)
		try check(response, body, "upload")
		struct Result: Decodable { let rejected: [String] }
		let rejected = try JSONDecoder().decode(Result.self, from: body).rejected
		await uploads.record(ops, rejected: rejected)
		try await batch.complete()
	}

	private func check(_ response: URLResponse, _ body: Data, _ what: String) throws {
		let status = (response as? HTTPURLResponse)?.statusCode ?? 0
		guard (200..<300).contains(status) else { throw PocError.http(what, status, String(decoding: body, as: UTF8.self)) }
	}
}
