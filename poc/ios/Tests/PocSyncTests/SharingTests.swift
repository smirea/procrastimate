import GRDB
import PocSync
import PowerSync
import XCTest

final class SharingTests: XCTestCase {
	func testViewShareDeliversRejectsEditsAndRevokes() async throws {
		let owner = try await Session.signUp("owner")
		let guest = try await Session.signUp("guest")
		let ownerDevice = try await Device.open(owner)
		let guestDevice = try await Device.open(guest)
		addTeardownBlock { await ownerDevice.close(); await guestDevice.close() }

		let task = newTask(owner.userId, title: "owner's task")
		try await ownerDevice.pool.write { try task.insert($0) }
		_ = try await eventually("owner uploads") { try await ownerDevice.pendingUploads() == 0 ? true : nil }
		let unrelated = try await guestDevice.task(task.id)
		XCTAssertNil(unrelated, "guest sees nothing before the share")

		var started = ContinuousClock.now
		try await owner.share(taskId: task.id, grantee: guest.userId, role: .view)
		let shared = try await eventually("guest receives shared task") { try await guestDevice.task(task.id) }
		report("(d) share(view) -> task on guest device: \(String(format: "%.1f", ms(.now - started))) ms")
		XCTAssertEqual(shared.title, "owner's task")
		XCTAssertEqual(shared.userId, owner.userId)
		let grant = try await guestDevice.pool.read { try AccessRecord.fetchOne($0, key: "\(guest.userId):task:\(task.id)") }
		XCTAssertEqual(grant?.role, .view)
		XCTAssertEqual(grant?.owner, owner.userId)

		try await guestDevice.pool.write { db in
			var copy = try TaskRecord.fetchOne(db, key: task.id)!
			try copy.updateChanges(db) { $0.title = "guest edit" }
		}
		let editedLocally = try await guestDevice.task(task.id)
		XCTAssertEqual(editedLocally?.title, "guest edit", "optimistic local edit")
		started = ContinuousClock.now
		_ = try await eventually("server rejects guest edit") { await guestDevice.connector.uploads.rejected.contains(task.id) ? true : nil }
		let rejectedAt = ContinuousClock.now
		let reverted = try await eventually("guest copy reverts") { try await guestDevice.task(task.id).flatMap { $0.title == "owner's task" ? $0 : nil } }
		report("(d) guest edit -> rejected by /api/upload: \(String(format: "%.1f", ms(rejectedAt - started))) ms; rejected -> reverted locally: \(String(format: "%.1f", ms(.now - rejectedAt))) ms")
		XCTAssertEqual(reverted.title, "owner's task")
		let ownerCopy = try await ownerDevice.task(task.id)
		XCTAssertEqual(ownerCopy?.title, "owner's task")

		started = ContinuousClock.now
		try await owner.share(taskId: task.id, grantee: guest.userId, role: nil)
		_ = try await eventually("guest loses task") { try await guestDevice.task(task.id) == nil ? true : nil }
		report("(d) revoke -> task gone on guest device: \(String(format: "%.1f", ms(.now - started))) ms")
		let grantAfter = try await guestDevice.pool.read { try AccessRecord.fetchCount($0) }
		XCTAssertEqual(grantAfter, 0)
		let ownerStill = try await ownerDevice.task(task.id)
		XCTAssertNotNil(ownerStill)
	}

	func testEditShareAcceptsGuestEdits() async throws {
		let owner = try await Session.signUp("owner")
		let guest = try await Session.signUp("editor")
		let ownerDevice = try await Device.open(owner)
		let guestDevice = try await Device.open(guest)
		addTeardownBlock { await ownerDevice.close(); await guestDevice.close() }

		let task = newTask(owner.userId, title: "editable")
		try await ownerDevice.pool.write { try task.insert($0) }
		_ = try await eventually("owner uploads") { try await ownerDevice.pendingUploads() == 0 ? true : nil }
		try await owner.share(taskId: task.id, grantee: guest.userId, role: .edit)
		_ = try await eventually("guest receives shared task") { try await guestDevice.task(task.id) }

		try await guestDevice.pool.write { db in
			var copy = try TaskRecord.fetchOne(db, key: task.id)!
			try copy.updateChanges(db) { $0.title = "edited by guest" }
		}
		_ = try await eventually("owner sees guest edit") { try await ownerDevice.task(task.id).flatMap { $0.title == "edited by guest" ? $0 : nil } }
		let rejected = await guestDevice.connector.uploads.rejected
		XCTAssertEqual(rejected, [])
	}
}
