import Foundation
import GRDB
import PocSync
import PowerSync
import XCTest

let api = URL(string: ProcessInfo.processInfo.environment["POC_API"] ?? "http://127.0.0.1:58081")!

struct Session: Sendable {
	let email: String
	let userId: String
	let bearer: String

	static func signUp(_ label: String) async throws -> Session {
		let email = "\(label)-\(UUID().uuidString.prefix(8).lowercased())@ios.poc.test"
		return try await authenticate("api/auth/sign-up/email", ["email": email, "password": "password123", "name": label])
	}

	static func signIn(_ email: String) async throws -> Session {
		try await authenticate("api/auth/sign-in/email", ["email": email, "password": "password123"])
	}

	private static func authenticate(_ path: String, _ body: [String: String]) async throws -> Session {
		let (data, response) = try await post(path, body, bearer: nil)
		struct User: Decodable { struct Inner: Decodable { let id: String }; let user: Inner }
		guard let bearer = response.value(forHTTPHeaderField: "set-auth-token") else { throw PocError.http("\(path) bearer", response.statusCode, String(decoding: data, as: UTF8.self)) }
		return Session(email: body["email"]!, userId: try JSONDecoder().decode(User.self, from: data).user.id, bearer: bearer)
	}

	func upload(_ batch: [UploadOp]) async throws -> [String] {
		let (body, _) = try await Session.post("api/upload", ["batch": batch], bearer: bearer)
		struct Result: Decodable { let rejected: [String] }
		return try JSONDecoder().decode(Result.self, from: body).rejected
	}

	func share(taskId: String, grantee: String, role: AccessRole?) async throws {
		var request = URLRequest(url: api.appending(path: "api/share"))
		request.httpMethod = "POST"
		request.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization")
		request.setValue("application/json", forHTTPHeaderField: "Content-Type")
		request.httpBody = try JSONSerialization.data(withJSONObject: ["taskId": taskId, "grantee": grantee, "role": role?.rawValue ?? NSNull()])
		let (body, response) = try await URLSession.shared.data(for: request)
		let status = (response as! HTTPURLResponse).statusCode
		guard status == 200 else { throw PocError.http("share", status, String(decoding: body, as: UTF8.self)) }
	}

	static func post(_ path: String, _ payload: some Encodable, bearer: String?) async throws -> (Data, HTTPURLResponse) {
		var request = URLRequest(url: api.appending(path: path))
		request.httpMethod = "POST"
		request.setValue("application/json", forHTTPHeaderField: "Content-Type")
		request.setValue("http://127.0.0.1:58083", forHTTPHeaderField: "Origin")
		if let bearer { request.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization") }
		request.httpBody = try JSONEncoder().encode(payload)
		let (body, response) = try await URLSession.shared.data(for: request)
		let http = response as! HTTPURLResponse
		guard http.statusCode == 200 else { throw PocError.http(path, http.statusCode, String(decoding: body, as: UTF8.self)) }
		return (body, http)
	}
}

struct Device {
	let session: Session
	let db: LocalDatabase
	let connector: PocConnector
	let path: String

	var pool: DatabasePool { db.pool }

	static func open(_ session: Session, connect: Bool = true) async throws -> Device {
		let path = FileManager.default.temporaryDirectory.appending(path: "poc-\(UUID().uuidString).sqlite").path
		let device = Device(session: session, db: try await LocalDatabase.open(path: path), connector: PocConnector(api: api, bearer: session.bearer), path: path)
		if connect { try await device.connect() }
		return device
	}

	func connect() async throws {
		try await db.powerSync.connect(connector: connector, options: ConnectOptions(crudThrottle: 0, retryDelay: 1))
		try await db.powerSync.waitForFirstSync()
	}

	func close() async {
		try? await db.powerSync.disconnect()
		try? await db.powerSync.close(deleteDatabase: true)
	}

	func task(_ id: String) async throws -> TaskRecord? {
		try await pool.read { try TaskRecord.fetchOne($0, key: id) }
	}

	func pendingUploads() async throws -> Int {
		try await db.powerSync.getCrudBatch(limit: 1000)?.crud.count ?? 0
	}
}

func eventually<T: Sendable>(_ what: String, timeout: TimeInterval = 15, _ probe: @Sendable () async throws -> T?) async throws -> T {
	let deadline = Date().addingTimeInterval(timeout)
	while Date() < deadline {
		if let value = try await probe() { return value }
		try await Task.sleep(for: .milliseconds(20))
	}
	throw Timeout(what: what, seconds: timeout)
}

struct Timeout: Error { let what: String; let seconds: TimeInterval }

func newTask(_ owner: String, title: String, labelIds: [String] = ["l1", "l2"], due: Due? = Due(date: "2026-10-20", time: "09:30")) -> TaskRecord {
	TaskRecord(id: UUID().uuidString.lowercased(), userId: owner, title: title, notes: "", labelIds: labelIds, due: due, priority: 4, order: 0.5, createdAt: Int64(Date().timeIntervalSince1970 * 1000))
}

func report(_ line: String) {
	print("RESULT: \(line)")
}

func json(_ value: JsonParam?) -> String {
	guard let value else { return "nil" }
	let encoder = JSONEncoder()
	encoder.outputFormatting = .sortedKeys
	return String(decoding: try! encoder.encode(value), as: UTF8.self)
}
