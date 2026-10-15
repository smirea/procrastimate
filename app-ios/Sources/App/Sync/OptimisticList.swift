import Observation
import SwiftUI

/// A list the server owns but the user changes instantly: an add shows its placeholder at once, a remove hides the row
/// at once, and a refusal puts things back and says so in a toast. Acting on a row that is still being created waits
/// for it. The web client's `OptimisticList` is the same.
@MainActor @Observable
final class OptimisticList<Value: Equatable & Sendable> {
    /// `id` stays the same from the placeholder to the server's copy, so the row never re-mounts.
    struct Row: Identifiable, Equatable {
        let id: String
        var value: Value
        var pending: Bool
    }

    private static var pending: String { "pending-" }

    private(set) var rows: [Row] = []
    @ObservationIgnored private var saving: [String: Task<Value?, Never>] = [:]
    @ObservationIgnored private let keyOf: (Value) -> String

    init(key: @escaping (Value) -> String) {
        keyOf = key
    }

    /// The list can be read before or after an add commits, so a row added here survives a list without it, and a row
    /// the list already has keeps its id, so it never re-mounts or loses state tied to it, like a token on show.
    func load(_ values: [Value]) {
        let ids = Set(values.map(keyOf))
        let saved = Dictionary(rows.filter { !$0.pending }.map { (keyOf($0.value), $0) }, uniquingKeysWith: { first, _ in first })
        let loaded = values.map { value in
            Row(id: saved[keyOf(value)]?.id ?? keyOf(value), value: value, pending: false)
        }
        let added = rows.filter { $0.pending || ($0.id.hasPrefix(Self.pending) && !ids.contains(keyOf($0.value))) }
        rows = loaded + added
    }

    @discardableResult
    func add(
        _ placeholder: Value,
        failure: String,
        toasts: Toasts,
        request: @escaping @MainActor () async throws -> Value
    ) -> Row {
        let row = Row(id: Self.pending + UUID().uuidString, value: placeholder, pending: true)
        rows.append(row)
        saving[row.id] = Task {
            do {
                let value = try await request()
                let id = keyOf(value)
                rows.removeAll { $0.id != row.id && !$0.pending && keyOf($0.value) == id }
                if let index = rows.firstIndex(where: { $0.id == row.id }) {
                    rows[index] = Row(id: row.id, value: value, pending: false)
                }
                return value
            } catch {
                _ = ErrorReport(failure, error: error)
                if rows.contains(where: { $0.id == row.id }) { toasts.show(failure) }
                rows.removeAll { $0.id == row.id }
                return nil
            }
        }
        return row
    }

    /// The server's copy of a row, or nil when the server refused to create it.
    func saved(_ row: Row) async -> Value? {
        if let task = saving[row.id] { return await task.value }
        return row.value
    }

    func remove(
        _ row: Row,
        failure: String,
        toasts: Toasts,
        request: @escaping @MainActor (Value) async throws -> Void
    ) async {
        guard let index = rows.firstIndex(where: { $0.id == row.id }) else { return }
        rows.remove(at: index)
        guard let value = await saved(row) else { return }
        do {
            try await request(value)
        } catch {
            _ = ErrorReport(failure, error: error)
            rows.insert(Row(id: row.id, value: value, pending: false), at: min(index, rows.count))
            toasts.show(failure)
        }
    }
}

/// Holds the place of a value only the server can make, like a new token or link, until it arrives.
struct PendingValue: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let label: String

    var body: some View {
        Capsule()
            .fill(.ink.opacity(0.09))
            .frame(maxWidth: 180, minHeight: 12, maxHeight: 12)
            .phaseAnimator(reduceMotion ? [1.0] : [0.45, 1.0]) { capsule, opacity in
                capsule.opacity(opacity)
            } animation: { _ in .easeInOut(duration: 0.9) }
            .accessibilityElement()
            .accessibilityLabel(label)
    }
}
