import GRDB
import PocSync
import PowerSync
import XCTest

final class RecordWriteTests: XCTestCase {
	func testInsertUpdateDeleteProduceCrudEntriesAndReachAnotherDevice() async throws {
		let me = try await Session.signUp("crud")
		let a = try await Device.open(me, connect: false)
		let b = try await Device.open(me)
		addTeardownBlock { await a.close(); await b.close() }

		var task = newTask(me.userId, title: "first")
		try await a.pool.write { [task] in try task.insert($0) }
		var crud = try await a.db.powerSync.getCrudBatch()!.crud
		report("insert -> \(crud.map { "\($0.op.rawValue) \(json($0.opDataTyped))" })")
		XCTAssertEqual(crud.map(\.op), [.put])
		XCTAssertEqual(Set(crud[0].opDataTyped!.keys), ["user_id", "title", "notes", "label_ids", "due", "priority", "order", "created_at"], "PUT omits NULL columns")

		task = try await a.pool.write { [task] db in
			var task = task
			try task.updateChanges(db) { $0.title = "second" }
			return task
		}
		crud = try await a.db.powerSync.getCrudBatch()!.crud
		report("updateChanges(title) -> \(crud[1].op.rawValue) \(json(crud[1].opDataTyped))")
		XCTAssertEqual(crud[1].op, .patch)
		XCTAssertEqual(crud[1].opDataTyped, ["title": .string("second")])

		task.priority = 1
		try await a.pool.write { [task] in try task.update($0) }
		crud = try await a.db.powerSync.getCrudBatch()!.crud
		report("update(full, priority changed) -> \(crud[2].op.rawValue) \(json(crud[2].opDataTyped))")
		XCTAssertEqual(crud[2].op, .patch)

		let id = task.id
		try await a.connect()
		_ = try await eventually("a uploads") { try await a.pendingUploads() == 0 ? true : nil }
		let synced = try await eventually("b sees insert and both updates") {
			try await b.task(id).flatMap { $0.title == "second" && $0.priority == 1 ? $0 : nil }
		}
		XCTAssertEqual(synced, TaskRecord(id: task.id, userId: me.userId, title: "second", notes: "", labelIds: ["l1", "l2"], due: Due(date: "2026-10-20", time: "09:30"), priority: 1, order: 0.5, createdAt: task.createdAt, createdBy: me.userId))

		let deleted = try await a.pool.write { [task] in try task.delete($0) }
		report("delete() returned \(deleted)")
		_ = try await eventually("b sees delete") { try await b.task(id) == nil ? true : nil }
		let uploaded = await a.connector.uploads.ops
		report("uploaded ops -> \(uploaded.map { "\($0.op) \(json($0.data))" })")
		XCTAssertEqual(uploaded.map(\.op), ["PUT", "PATCH", "PATCH", "DELETE"])
		XCTAssertNil(uploaded[3].data)
	}

	func testUpsertSaveAndMissingRowsOnViews() async throws {
		let me = try await Session.signUp("upsert")
		let a = try await Device.open(me, connect: false)
		addTeardownBlock { await a.close() }

		let fresh = newTask(me.userId, title: "upserted")
		do {
			try await a.pool.write { try fresh.upsert($0) }
			XCTFail("upsert on a PowerSync view succeeded")
		} catch {
			report("upsert(new) threw: \(String(describing: error).prefix(60))")
			XCTAssertTrue("\(error)".contains("cannot UPSERT a view"))
		}

		let saved = newTask(me.userId, title: "saved new")
		try await a.pool.write { try saved.save($0) }
		let savedRow = try await a.task(saved.id)
		report("save(new) did not throw; row exists: \(savedRow != nil)")
		XCTAssertNil(savedRow, "save() takes its update path, believes a row changed, and never inserts")

		var existing = newTask(me.userId, title: "existing")
		try await a.pool.write { [existing] in try existing.insert($0) }
		existing.title = "existing saved"
		try await a.pool.write { [existing] in try existing.save($0) }
		let existingRow = try await a.task(existing.id)
		XCTAssertEqual(existingRow?.title, "existing saved", "save() of an existing row updates it")
		try await a.pool.write { [existing] in try existing.update($0) }

		do {
			try await a.pool.write { [existing] db in var dup = existing; dup.title = "dup"; try dup.insert(db) }
			XCTFail("duplicate insert succeeded")
		} catch {
			report("insert(duplicate id) threw: \(String(describing: error).prefix(70))")
		}

		let missing = newTask(me.userId, title: "never inserted")
		func outcome(_ body: @escaping @Sendable (Database) throws -> String) async -> String {
			do {
				return try await a.pool.write { db in
					let before = db.totalChangesCount
					let result = try body(db)
					return "\(result) (total_changes +\(db.totalChangesCount - before))"
				}
			} catch {
				return "threw \(String(describing: error).prefix(40))"
			}
		}
		let outcomes = [
			"update: " + (await outcome { db in try missing.update(db); return "ok" }),
			"updateChanges: " + (await outcome { db in var copy = missing; return "\(try copy.updateChanges(db) { $0.title = "y" })" }),
			"delete: " + (await outcome { db in "\(try missing.delete(db))" }),
			"updateAll: " + (await outcome { db in "\(try TaskRecord.filter(key: missing.id).updateAll(db, Column("title").set(to: "z")))" }),
			"deleteAll: " + (await outcome { db in "\(try TaskRecord.filter(key: missing.id).deleteAll(db))" }),
		]
		report("missing row, one transaction each: \(outcomes)")
		XCTAssertEqual(outcomes, ["update: ok (total_changes +1)", "updateChanges: true (total_changes +1)", "delete: true (total_changes +1)", "updateAll: 1 (total_changes +1)", "deleteAll: 1 (total_changes +1)"], "GRDB cannot tell a missing row on a PowerSync view")

		let sameTransaction = try await a.pool.write { db -> [String] in
			(0..<3).map { _ in
				let before = db.totalChangesCount
				do {
					try missing.update(db)
					return "ok (+\(db.totalChangesCount - before))"
				} catch {
					return "threw (+\(db.totalChangesCount - before))"
				}
			}
		}
		report("update(missing) three times in one transaction: \(sameTransaction)")
		XCTAssertEqual(sameTransaction, ["ok (+1)", "threw (+0)", "threw (+0)"], "only the first view write per transaction gets the phantom change")

		let diagnostic = try await a.pool.write { db -> String in
			let tx = { try Row.fetchAll(db, sql: "SELECT next_tx FROM ps_tx").map(\.description).joined() }
			let (changes, txBefore) = (db.totalChangesCount, try tx())
			try db.execute(sql: "UPDATE tasks SET title = 'x' WHERE id = 'no-such-id'")
			return "total_changes delta=\(db.totalChangesCount - changes), ps_tx \(txBefore) -> \(try tx())"
		}
		report("diagnostic raw UPDATE of missing id on view -> \(diagnostic)")

		let crud = try await a.db.powerSync.getCrudBatch()?.crud ?? []
		report("crud -> \(crud.map { "\($0.op.rawValue) \($0.id == existing.id ? "existing" : $0.id) \(json($0.opDataTyped))" })")
		XCTAssertEqual(crud.map(\.id), [existing.id, existing.id], "nothing queued for upsert, save(new), or the missing row; update() with no change queues nothing under ignoreEmptyUpdates")
		XCTAssertEqual(crud.map(\.op), [.put, .patch])
	}
}
