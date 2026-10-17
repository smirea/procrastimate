import GRDB
import PocSync
import PowerSync
import XCTest

final class JsonRoundTripTests: XCTestCase {
	func testJsonColumnsSurviveServerRoundTrip() async throws {
		let me = try await Session.signUp("json")
		let a = try await Device.open(me)
		let b = try await Device.open(me)
		addTeardownBlock { await a.close(); await b.close() }

		let full = newTask(me.userId, title: "full", labelIds: ["l1", "läbel \"2\"", "🦀"], due: Due(date: "2026-10-20", time: "09:30"))
		let dateOnly = newTask(me.userId, title: "date only", labelIds: ["solo"], due: Due(date: "2026-11-01"))
		let empty = newTask(me.userId, title: "empty", labelIds: [], due: nil)
		try await a.pool.write { db in
			for task in [full, dateOnly, empty] { try task.insert(db) }
		}

		for sent in [full, dateOnly, empty] {
			let received = try await eventually("b receives \(sent.title)") { try await b.task(sent.id) }
			var expected = sent
			expected.createdBy = me.userId
			XCTAssertEqual(received, expected)
			report("(c) \(sent.title): labelIds=\(received.labelIds) due=\(String(describing: received.due))")
		}

		let raw = try await b.pool.read { db in
			try Row.fetchOne(db, TaskRecord.filter(key: full.id).select(Column("label_ids"), Column("due")))!.description
		}
		let local = try await a.pool.read { db in
			try Row.fetchOne(db, TaskRecord.filter(key: full.id).select(Column("label_ids"), Column("due")))!.description
		}
		report("(c) stored text on writer (GRDB-encoded): \(local)")
		report("(c) stored text on receiver (from Postgres jsonb): \(raw)")

		try await b.db.powerSync.disconnect()
		try await b.pool.write { db in
			var task = try TaskRecord.fetchOne(db, key: full.id)!
			task.notes = "full update on b"
			try task.update(db)
		}
		let fullUpdate = try await b.db.powerSync.getCrudBatch()!.crud.last!
		report("(c) update() of a server-synced record changing only notes -> \(fullUpdate.op.rawValue) \(json(fullUpdate.opDataTyped))")
		XCTAssertEqual(Set(fullUpdate.opDataTyped!.keys), ["notes", "label_ids", "due"], "jsonb text differs from GRDB's JSON bytes, so update() re-sends JSON columns")

		try await b.pool.write { db in
			var task = try TaskRecord.fetchOne(db, key: full.id)!
			try task.updateChanges(db) { $0.notes = "updateChanges on b" }
		}
		let changesOnly = try await b.db.powerSync.getCrudBatch()!.crud.last!
		report("(c) updateChanges() of the same record changing only notes -> \(changesOnly.op.rawValue) \(json(changesOnly.opDataTyped))")
		XCTAssertEqual(changesOnly.opDataTyped, ["notes": .string("updateChanges on b")])

		try await b.connect()
		_ = try await eventually("a sees notes edit") { try await a.task(full.id).flatMap { $0.notes == "updateChanges on b" ? $0 : nil } }
		let after = try await a.task(full.id)
		XCTAssertEqual(after?.labelIds, full.labelIds)
		XCTAssertEqual(after?.due, full.due)
	}
}
