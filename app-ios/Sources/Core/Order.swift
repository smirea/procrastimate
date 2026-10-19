/// Fractional sibling order, as `shared/order.ts`: projects, sections, and subtasks sort and move by it.
protocol Ordered: Identifiable<String> {
    var order: Double { get set }
    var createdAt: Int { get }
}

extension Project: Ordered {}
extension ProjectSection: Ordered {}
extension TaskItem: Ordered {}

enum Order {
    /// Below this gap a move renumbers the siblings instead of splitting it further.
    static let minGap = 1e-9

    /// By `order`, then `createdAt`, then `id` in UTF-16 order, as JavaScript compares strings.
    static func siblings<T: Ordered>(_ a: T, _ b: T) -> Bool? {
        if a.order != b.order { return a.order < b.order }
        if a.createdAt != b.createdAt { return a.createdAt < b.createdAt }
        if a.id != b.id { return a.id.utf16.lexicographicallyPrecedes(b.id.utf16) }
        return nil
    }

    static func sorted<T: Ordered>(_ items: [T]) -> [T] { items.stableSorted(by: siblings) }

    /// The orders to write to move `id` to `index`: only the moved one's, or every sibling's new position when the gap
    /// is too small to split, in placed order. Siblings already in place are left out. `moveOrders` in `shared/order.ts`.
    static func moveOrders<T: Ordered>(_ items: [T], _ id: String, _ index: Int) -> [(id: String, order: Double)] {
        guard let moved = items.first(where: { $0.id == id }) else { return [] }
        let siblings = sorted(items)
        let others = siblings.filter { $0.id != id }
        let at = max(0, min(index, others.count))
        let previous = at > 0 ? others[at - 1].order : nil
        let following = at < others.count ? others[at].order : nil
        if let previous, let following, following - previous < minGap {
            var placed = others
            placed.insert(moved, at: at)
            return placed.enumerated().compactMap { order, s in s.order == Double(order) ? nil : (s.id, Double(order)) }
        }
        if siblings.firstIndex(where: { $0.id == id }) == at { return [] }
        switch (previous, following) {
        case (nil, nil): return [(id, 0)]
        case let (nil, following?): return [(id, following - 1)]
        case let (previous?, nil): return [(id, previous + 1)]
        case let (previous?, following?): return [(id, (previous + following) / 2)]
        }
    }

    /// The siblings `orders` names, with their new orders, in that order.
    static func moved<T: Ordered>(_ items: [T], _ orders: [(id: String, order: Double)]) -> [T] {
        orders.compactMap { change in
            items.first { $0.id == change.id }.map { item in
                var item = item
                item.order = change.order
                return item
            }
        }
    }
}

extension Array where Element: Identifiable<String> {
    /// The list with `id`'s element changed, or unchanged when it is absent.
    func updating(_ id: String, _ change: (inout Element) -> Void) -> [Element] {
        map { element in
            guard element.id == id else { return element }
            var element = element
            change(&element)
            return element
        }
    }

    /// The list with `changed` in place of the elements that share their ids.
    func put(_ changed: [Element]) -> [Element] {
        let byId = Dictionary(changed.map { ($0.id, $0) }, uniquingKeysWith: { _, last in last })
        return map { byId[$0.id] ?? $0 }
    }
}
