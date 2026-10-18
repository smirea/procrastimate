/// A screen the floating tab bar can hold. Anything Browse lists can be pinned except Completed. A place or an event
/// keeps its name, since it only exists while open tasks point at it.
public enum Pin: Hashable, Codable, Sendable {
    case inbox
    case noDate
    case project(id: String)
    case label(id: String)
    case place(key: String, name: String)
    case event(id: String, title: String)

    public static let defaults: [Pin] = [.inbox, .noDate]

    /// Identity without the stored names, so a renamed event still counts as the pin it was.
    public var key: String {
        switch self {
        case .inbox: "inbox"
        case .noDate: "noDate"
        case let .project(id): "project:\(id)"
        case let .label(id): "label:\(id)"
        case let .place(key, _): "place:\(key)"
        case let .event(id, _): "event:\(id)"
        }
    }
}

extension [Pin] {
    /// The pins after a list that shows only `shown` of them is edited to `next`. The edited pins fill the shown pins'
    /// slots in order, and any extra go last, so a hidden pin keeps its place for when its tab comes back.
    public func editing(shown: [Pin], to next: [Pin]) -> [Pin] {
        var queue = next[...]
        var result = compactMap { pin -> Pin? in
            shown.contains(pin) ? queue.popFirst() : pin
        }
        result += queue
        return result
    }
}
