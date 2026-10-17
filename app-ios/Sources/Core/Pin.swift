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
    /// The pins once `pin`'s project or label is gone from the store. Sync merging it into `survivor` moves the pin
    /// there for good, or drops it when the survivor is already pinned. With no survivor the pin stays, hidden until
    /// its project or label comes back from an undo or a restored share.
    public func following(_ pin: Pin, to survivor: Pin?) -> [Pin] {
        guard let survivor else { return self }
        if contains(survivor) { return filter { $0 != pin } }
        return map { $0 == pin ? survivor : $0 }
    }
}
