import Foundation
import GRDB
import PocSync
import PowerSync
import XCTest

final class FirstSeen: @unchecked Sendable {
	private let lock = NSLock()
	private var times: [String: ContinuousClock.Instant] = [:]
	private(set) var fires = 0

	func record(_ titles: [String], at instant: ContinuousClock.Instant) {
		lock.withLock {
			fires += 1
			for title in titles where times[title] == nil { times[title] = instant }
		}
	}

	func time(_ title: String) -> ContinuousClock.Instant? {
		lock.withLock { times[title] }
	}
}

func observeTitles(_ device: Device) -> (FirstSeen, AnyDatabaseCancellable) {
	let seen = FirstSeen()
	let cancellable = ValueObservation
		.tracking { try TaskRecord.fetchAll($0) }
		.start(in: device.pool, scheduling: .async(onQueue: DispatchQueue(label: "observation")), onError: { XCTFail("observation failed: \($0)") }, onChange: { tasks in
			seen.record(tasks.map(\.title), at: .now)
		})
	return (seen, cancellable)
}

func ms(_ duration: Duration) -> Double {
	Double(duration.components.seconds) * 1000 + Double(duration.components.attoseconds) / 1e15
}

func summary(_ samples: [Double]) -> String {
	let sorted = samples.sorted()
	return "samples=\(samples.map { String(format: "%.1f", $0) }) median=\(String(format: "%.1f", sorted[sorted.count / 2])) max=\(String(format: "%.1f", sorted.last!)) ms"
}

final class ObservationTests: XCTestCase {
	func testValueObservationFiresForChangesFromAnotherClient() async throws {
		let me = try await Session.signUp("observe")
		let other = try await Session.signIn(me.email)
		XCTAssertNotEqual(other.bearer, me.bearer)
		let a = try await Device.open(me)
		addTeardownBlock { await a.close() }
		let (seen, cancellable) = observeTitles(a)
		defer { cancellable.cancel() }

		var latencies: [Double] = []
		var posts: [Double] = []
		for sample in 0..<5 {
			let title = "remote-\(sample)-\(UUID().uuidString.prefix(6))"
			let started = ContinuousClock.now
			let rejected = try await other.upload([UploadOp(op: "PUT", type: "tasks", id: UUID().uuidString.lowercased(), data: [
				"user_id": .string(me.userId), "title": .string(title), "notes": .string(""), "label_ids": .string("[\"l1\"]"),
				"due": .null, "priority": .int(4), "order": .double(1), "created_at": .int(Int(Date().timeIntervalSince1970 * 1000)),
			])])
			let returned = ContinuousClock.now
			XCTAssertEqual(rejected, [])
			let fired = try await eventually("observation sees \(title)") { seen.time(title) }
			posts.append(ms(returned - started))
			latencies.append(ms(fired - returned))
			try await Task.sleep(for: .milliseconds(300))
		}
		report("(b) HTTP upload POST round trip: \(summary(posts))")
		report("(b) upload POST returned -> GRDB ValueObservation fired on device: \(summary(latencies))")
		report("(b) observation fired \(seen.fires) times for 5 remote inserts")
	}

	func testDeviceToDeviceLatencyThroughGRDB() async throws {
		let me = try await Session.signUp("d2d")
		let a = try await Device.open(me)
		let b = try await Device.open(me)
		addTeardownBlock { await a.close(); await b.close() }
		let (seen, cancellable) = observeTitles(b)
		defer { cancellable.cancel() }

		var latencies: [Double] = []
		for sample in 0..<5 {
			let task = newTask(me.userId, title: "local-\(sample)-\(UUID().uuidString.prefix(6))")
			try await a.pool.write { try task.insert($0) }
			let written = ContinuousClock.now
			let fired = try await eventually("device b sees \(task.title)") { seen.time(task.title) }
			latencies.append(ms(fired - written))
			try await Task.sleep(for: .milliseconds(300))
		}
		report("(b) GRDB insert on device A -> ValueObservation on device B: \(summary(latencies))")
	}
}
