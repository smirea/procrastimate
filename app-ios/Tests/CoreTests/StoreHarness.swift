import Core
import Foundation

/// What a store handed its writer, in order, as the app's database writer would receive it.
@MainActor final class WrittenRows {
    var batches: [RowBatch] = []
    var writes: [RowWrite] { batches.flatMap(\.writes) }
}

func sequentialIds() -> () -> String {
    var next = 0
    return {
        next += 1
        return "id-\(next)"
    }
}

/// A store for `me` over `rows`, recording every batch it writes and finishing each at once, like an idle database.
/// A nil `me` is a device that does not know whose database it holds yet.
@MainActor func recordingStore(
    me: String? = "me",
    rows: StoredRows = StoredRows(),
    clock: AppClock = .fixed(pinned, timeZone: TimeZone(identifier: "UTC")!),
    newId: @escaping () -> String = sequentialIds()
) -> (Store, WrittenRows) {
    let store = Store(me: me, spaces: me.map { Spaces(rows, me: $0) } ?? Spaces(), clock: clock, newId: newId)
    let written = WrittenRows()
    store.writer = { [weak store] batch in
        written.batches.append(batch)
        _ = store?.written(batch.version)
    }
    return (store, written)
}

func put(_ kind: EntityKind, _ id: String, _ values: [String: JSONValue]) -> RowWrite {
    RowWrite(op: .put, kind: kind, id: id, values: values)
}

func patch(_ kind: EntityKind, _ id: String, _ values: [String: JSONValue]) -> RowWrite {
    RowWrite(op: .patch, kind: kind, id: id, values: values)
}

let pinnedMs = JSONValue.number(Double(pinned.epochMilliseconds))

/// Rows holding `me`'s settings row, as every user has once the first sync arrived.
func settingsRows(_ settings: API.Settings = API.Settings(), owner: String = "me") -> StoredRows {
    var rows = StoredRows()
    rows.settings = [Owned(owner: owner, value: settings)]
    return rows
}
