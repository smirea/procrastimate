# iOS proof of concept results: PowerSync Swift with GRDB

This file answers question 3 and the iOS side of questions 5, 6, and 8 in [`docs/postgres-powersync.md`](../../docs/postgres-powersync.md). The package is throwaway, like the rest of `poc/`.

Environment: Xcode 27.0 (27A266a), Swift 6.4, `powersync-swift` 1.16.4 (core extension 0.5.3), GRDB 7.11.1, an iPhone 17 simulator on iOS 27.0 named `poc-powersync`, and the PoC services from `poc/` (Postgres 17 on 55432, PowerSync on 58080, the Bun API on 58081). All numbers are local loopback on one Mac.

## Summary

| Question                                                                                                                | Result                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| a. GRDB records insert, update, and delete through the PowerSync views, with the right CRUD entries, and reach Postgres | VERIFIED                                                                                        |
| a. `upsert` and `save` on the views                                                                                     | VERIFIED that they do not work: `upsert` throws, `save` of a new record silently writes nothing |
| b. A GRDB `ValueObservation` fires when PowerSync applies a change from another client                                  | VERIFIED, about 12 to 19 ms after the upload POST returns                                       |
| c. `label_ids` and `due` survive the server round trip as `[String]` and `Due?`                                         | VERIFIED                                                                                        |
| d. A `view` share delivers the task, a guest edit is rejected and reverts, and revoking removes the row                 | VERIFIED                                                                                        |
| The library builds for watchOS                                                                                          | VERIFIED                                                                                        |

## Commands

```sh
cd poc/ios
swift test
xcrun simctl create poc-powersync com.apple.CoreSimulator.SimDeviceType.iPhone-17 com.apple.CoreSimulator.SimRuntime.iOS-27-0
xcrun simctl boot <udid>
xcodebuild test -scheme PocSync -destination 'platform=iOS Simulator,id=<udid>' -derivedDataPath /tmp/poc-ios-dd -collect-test-diagnostics never
xcodebuild build -scheme PocSync -destination 'generic/platform=watchOS Simulator' -derivedDataPath /tmp/poc-watch-dd
xcrun simctl shutdown <udid>
```

`swift test` ran 7 tests with 0 failures in 4.7 s. The simulator run also passed 7 of 7, in 5.2 s. The watchOS build ended in `** BUILD SUCCEEDED **` and compiled the `PocSync` target for `Debug-watchsimulator`. Every test line that starts with `RESULT:` prints a measurement. The tests read with `grep RESULT:`.

Without `-collect-test-diagnostics never`, `xcodebuild test` passed in 5 s and then waited 600 s on `simctl diagnose` before it exited ("Failure collecting diagnostics from simulator: Timed out after 600.0 seconds"). The tests did not cause this wait.

## Package

- `Sources/PocSync/Schema.swift` holds the PowerSync `Schema` for `tasks` and `access`. `tasks` sets `ignoreEmptyUpdates: true` (see gotcha 5).
- `Sources/PocSync/Records.swift` holds `TaskRecord`, `Due`, and `AccessRecord`. They are `Codable, FetchableRecord, PersistableRecord`, with `databaseColumnDecodingStrategy = .convertFromSnakeCase` and `databaseColumnEncodingStrategy = .convertToSnakeCase`. Neither file has hand-written SQL or a hand-written column list.
- `Sources/PocSync/Connector.swift` holds `PocConnector`. `fetchCredentials` calls `GET /api/auth/token` with the bearer. `uploadData` reads `getCrudBatch(limit: 200)`, posts `{batch:[{op,type,id,data}]}` to `/api/upload`, records `rejected`, and calls `batch.complete()`.
- `Sources/PocSync/Database.swift` holds `LocalDatabase.open(path:)`. It calls `configurePowerSync(schema:)`, opens a `DatabasePool` and `openPowerSyncWithGRDB`, then awaits `getPowerSyncVersion()` so the views exist (see gotcha 1).
- `Tests/PocSyncTests/` holds the tests. `Support.swift` signs users up and in over HTTP and opens a "device", meaning its own SQLite file with its own PowerSync connection. Every app read and write in the tests goes through GRDB records or the GRDB query interface. Raw SQL appears only in two diagnostics that inspect PowerSync internals (`sqlite_master`, `ps_tx`).

## a. Insert, update, and delete through GRDB records

Test `RecordWriteTests.testInsertUpdateDeleteProduceCrudEntriesAndReachAnotherDevice`. Device A writes while disconnected so the CRUD queue can be read before upload. Device B is a second database of the same user, connected to PowerSync.

| GRDB call on A                                                         | CRUD entry                                                                                                                                         |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `task.insert(db)`                                                      | `PUT` with every non-null column. `completed_at` and `created_by` are NULL and absent.                                                             |
| `task.updateChanges(db) { $0.title = "second" }`                       | `PATCH {"title":"second"}`                                                                                                                         |
| `task.update(db)`, the full-row update, after changing only `priority` | `PATCH {"priority":1}`. PowerSync's trigger drops unchanged columns, so a full update yields a minimal PATCH too (see gotcha 4 for the exception). |
| `task.delete(db)`                                                      | `DELETE` with no data                                                                                                                              |

After A connects, the connector uploads exactly `PUT, PATCH {"title"}, PATCH {"priority"}, DELETE`. B then reads the task through PowerSync with `title "second"`, `priority 1`, and `createdBy` stamped by the server, which proves the write reached Postgres and came back out. After the delete, B's row disappears. Times in the two runs: 0.20 to 0.37 s for the whole test.

`upsert` and `save`, in test `testUpsertSaveAndMissingRowsOnViews`:

- `upsert` and `upsertAndFetch` throw `SQLite error 1: cannot UPSERT a view`. SQLite rejects `ON CONFLICT` on a view.
- `save()` of a new record returns without error, inserts nothing, and queues nothing. `save` tries `UPDATE` first, GRDB believes a row changed, and it never runs the `INSERT`.
- `save()` of an existing record updates it correctly.
- `insert()` of an id that already exists throws `UNIQUE constraint failed: ps_data__tasks.id`.
- On a missing row, `update()` does not throw `recordNotFound`, `updateChanges` returns `true`, `delete()` returns `true`, and `updateAll`/`deleteAll` return `1`. That holds when the call is the first write to a PowerSync view in its transaction. In the same transaction, three `update()` calls on a missing row gave `["ok (+1)", "threw (+0)", "threw (+0)"]`.

Root cause, measured. GRDB detects affected rows on a view through the `sqlite3_total_changes()` delta, because `sqlite3_changes()` ignores INSTEAD OF triggers (`GRDB/Core/Database.swift`, `countChanges`). PowerSync's CRUD virtual table bumps `ps_tx.next_tx` when SQLite begins it, once per transaction, even when no row matches. A raw `UPDATE tasks ... WHERE id = 'no-such-id'` moved `total_changes` by 1 and `ps_tx.next_tx` from 11 to 12. GRDB counts that bookkeeping write as the record's row.

Consequence for the iOS client: never call `save` or `upsert`, and never trust GRDB's not-found signal on a synced table. The planned `diff` already knows whether each row is an insert, an update, or a delete, so it should call `insert`, `updateChanges`, and `delete` explicitly.

## b. ValueObservation on changes from another client

Test `ObservationTests.testValueObservationFiresForChangesFromAnotherClient`. Device A observes `TaskRecord.fetchAll` with `ValueObservation.start(in:scheduling: .async(onQueue:))`. A second session of the same user, from `POST /api/auth/sign-in/email` with a different bearer, posts a `PUT` to `/api/upload` over `URLSession`. The interval runs from the POST returning, after Postgres committed, to the observation callback that first contains the new title. Both instants come from `ContinuousClock` in one process.

| Run                        | 5 samples (ms)              | Median | Max  |
| -------------------------- | --------------------------- | ------ | ---- |
| macOS `swift test`         | 7.6, 14.7, 17.0, 9.9, 11.8  | 11.8   | 17.0 |
| iOS simulator              | 6.8, 21.0, 19.2, 17.4, 19.8 | 19.2   | 21.0 |
| iOS simulator, earlier run | 8.3, 13.3, 10.4, 12.1, 15.7 | 12.1   | 15.7 |

The observation fired 6 times for 5 remote inserts: the initial value plus one per change. PowerSync's writes to its internal tables caused no extra fires. The bridge works because `GRDBConnectionPool.write` collects every table PowerSync's sync writes touch and calls `database.notifyChanges(in:)`. The observation's region resolves the `tasks` view to `ps_data__tasks`.

Device to device through GRDB (`testDeviceToDeviceLatencyThroughGRDB`). A `TaskRecord.insert` on A returns, and then B's observation fires. That covers A's upload with `crudThrottle: 0`, the API, Postgres, replication, the PowerSync stream, and B's apply.

| Run           | 5 samples (ms)               | Median | Max  |
| ------------- | ---------------------------- | ------ | ---- |
| macOS         | 13.5, 34.6, 28.6, 35.2, 41.8 | 34.6   | 41.8 |
| iOS simulator | 18.4, 52.6, 46.9, 25.5, 49.8 | 46.9   | 52.6 |

What limits these numbers: everything runs on loopback with no network latency, so they show the stack's own overhead (Postgres logical replication, PowerSync's bucket update, the Bun proxy stream, and the SQLite apply). They do not predict a cloud figure. The first sample of each run is consistently the fastest. That is observed and unexplained, and does not change the conclusion.

## c. JSON round trip

Test `JsonRoundTripTests.testJsonColumnsSurviveServerRoundTrip`. A inserts three tasks through GRDB: one with labels `["l1", "läbel \"2\"", "🦀"]` and `Due(date: "2026-10-20", time: "09:30")`, one with `Due(date: "2026-11-01")` and no time, and one with `[]` and `due: nil`. B decodes each as a `TaskRecord` equal to the original, with `createdBy` set by the server. Postgres stores real jsonb:

```
   title   | labels_type |          label_ids          | due_type |                   due
-----------+-------------+-----------------------------+----------+-----------------------------------------
 date only | array       | ["solo"]                    | object   | {"date": "2026-11-01"}
 empty     | array       | []                          |          |
 full      | array       | ["l1", "läbel \"2\"", "🦀"] | object   | {"date": "2026-10-20", "time": "09:30"}
```

(`docker exec procrastimate-poc-postgres-1 psql -U postgres -d app -c "SELECT title, jsonb_typeof(label_ids), label_ids, jsonb_typeof(due), due FROM tasks ..."`). A nil `due` is SQL NULL, not the string `"null"`, and a nil `time` is omitted from the object.

GRDB stores a nested `Codable` and an array as JSON text without any custom code. The text differs between the writer and the receiver:

- Writer (GRDB): `["l1","läbel \"2\"","🦀"]` and `{"date":"2026-10-20","time":"09:30"}`
- Receiver (Postgres jsonb output): `["l1", "läbel \"2\"", "🦀"]` and `{"date": "2026-10-20", "time": "09:30"}`

Both decode to the same Swift values. The difference matters for updates (gotcha 4).

## d. Sharing through the `access` table

Test `SharingTests.testViewShareDeliversRejectsEditsAndRevokes`, between an owner and a guest who are separate users with separate devices.

1. Before the share, the guest's database has no copy of the task.
2. The owner calls `POST /api/share {role:"view"}`. The task arrives on the guest's device with the owner's `user_id`, and an `AccessRecord` with `role == .view` arrives with it. Time: 32.4 ms on macOS, 42.0 ms on the simulator.
3. The guest calls `updateChanges { $0.title = "guest edit" }`. The local copy shows the edit at once. `/api/upload` returns the id in `rejected` within 30 ms. The connector completes the batch anyway, and the next checkpoint restores `"owner's task"` 80.6 ms later on macOS, and 98 to 218 ms later across all runs. The owner's copy never changes.
4. The owner calls `POST /api/share {role:null}`. The task and the access row both disappear from the guest's database: 31.8 ms on macOS, 44.4 ms on the simulator. The owner keeps the task.

`testEditShareAcceptsGuestEdits` checks the opposite case: with `role:"edit"` the guest's edit reaches the owner, and `rejected` stays empty.

The share and revoke times come from a 20 ms polling loop, so they carry up to 20 ms of polling error. The section b numbers come from observation callbacks and carry no polling error.

## Gotchas

1. **The views do not exist until PowerSync initializes.** `openPowerSyncWithGRDB` returns right away, and a GRDB read or write before any PowerSync call fails with `no such table: tasks`. Initialization (`powersync_init` plus applying the schema) runs lazily on the first PowerSync API call. `LocalDatabase.open` awaits `getPowerSyncVersion()` to force it. The SDK's own GRDB tests hide this by calling `disconnectAndClear()` in `setUp`.
2. **`upsert` cannot work on views, and `save` silently drops new records.** See section a. Use explicit `insert`, `updateChanges`, and `delete`.
3. **GRDB's not-found detection is wrong on PowerSync views** for the first view write in each transaction (`update` does not throw, `delete` returns `true`). The cause is the `ps_tx` bookkeeping write described in section a.
4. **Use `updateChanges`, not a full-row `update`, on rows that came from the server.** PowerSync's PATCH keeps only the columns whose stored value changed. A full `update()` of a synced row rewrites the JSON columns in GRDB's compact form, which no longer matches Postgres's spaced form. A notes-only edit then queued `PATCH {"due":…, "label_ids":…, "notes":…}`, which under last-write-wins clobbers concurrent label and due edits from other devices. `updateChanges` compares GRDB's encoding before and after the change and queued only `PATCH {"notes":…}`.
5. **`ignoreEmptyUpdates: true` drops no-op PATCHes.** Without it, an `update()` that changed nothing queued `PATCH {}`. With it, nothing is queued. The schema sets it on `tasks`.
6. **`PowerSyncBackendConnector` is deprecated in 1.16.** Its declaration says "Please implement PowerSyncBackendConnectorProtocol directly". `PocConnector` is a `final class` that conforms to the protocol rather than a subclass.
7. **Use `opDataTyped` for upload.** `CrudEntry.opData` is `[String: String?]` and turns integers and reals into strings. `opDataTyped` is a `JsonParam` that encodes straight to JSON with `priority` as a number and `order` as a double. The JSON columns arrive as strings, which the server already `JSON.parse`s.
8. **Column names under the snake-case strategies.** The records use the strategies and no `CodingKeys`. Queries name columns as strings (`Column("label_ids")`). I infer, without testing, that `Column(CodingKeys.labelIds)` would name the camelCase key and miss the column.
9. **`PowerSyncGRDB` is labelled alpha.** The README says "the API may change significantly … used with caution in production". Its listed limitations are that `updateSchema` is not fully supported over GRDB connections, that PowerSync and GRDB must be linked statically, and that the schema is declared twice (the PowerSync `Schema` and the GRDB records). The iOS build compiled `PowerSyncGRDB` with no compiler warnings. At runtime, both simulator runs logged one Thread Performance Checker warning at `GRDB/Utils/Pool.swift:97` during `testJsonColumnsSurviveServerRoundTrip`: "Thread running at User-initiated quality-of-service class waiting on a lower QoS thread running at Default quality-of-service class". That is a priority inversion inside GRDB's connection pool when reads and PowerSync's writes overlap. It did not affect results, but the real app should check it again under the main actor. Everything in this file worked on 1.16.4.
10. **Platforms.** `URL.appending(path:)` needs iOS 16. The package declares iOS 17, macOS 14, and watchOS 10. The app targets iOS 27.
11. **Swift 6 strict concurrency.** `pool.write { }` closures are `@Sendable`, so a mutable record must be passed in by value (`{ [task] db in var task = task; … }`). `GRDB.Row` is not `Sendable`, so rows cannot leave a `read` closure.
12. **Setup.** The first `swift package resolve` stopped with `error: fatalError` right after downloading the 35.5 MB `powersync-sqlite-core.xcframework.zip`. The second run succeeded.
13. **The JWT is EdDSA, not RS256.** `/api/auth/token` signs with `alg: EdDSA`, and PowerSync accepts it through the JWKS. The design doc says RS256.

## Not covered

- Cloud latency. Every number above is loopback.
- Offline writes across an app restart, and conflicts between two devices editing the same field.
- A real device. The tests ran on the macOS host and the iOS simulator only.
