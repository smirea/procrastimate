import Foundation

/// The `procrastimate://` links the app opens: `task/<id>` from Notouroboros, and the rest from widgets and controls.
/// A list travels as its `WidgetList.key`, which the app resolves against its own catalog.
public enum AppLink: Hashable, Sendable {
    case task(id: String)
    case list(key: String)
    /// Quick add on a list, or with no context.
    case add(list: String?)
    case ramble(list: String?)

    static let scheme = "procrastimate"

    public init?(_ url: URL) {
        guard url.scheme == Self.scheme, let host = url.host() else { return nil }
        let list = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "list" }?.value
        switch host {
        case "task":
            guard url.pathComponents.count == 2 else { return nil }
            self = .task(id: url.pathComponents[1])
        case "list":
            guard let list else { return nil }
            self = .list(key: list)
        case "add": self = .add(list: list)
        case "ramble": self = .ramble(list: list)
        default: return nil
        }
    }

    public var url: URL {
        var components = URLComponents()
        components.scheme = Self.scheme
        let list: String?
        switch self {
        case let .task(id):
            components.host = "task"
            components.path = "/\(id)"
            list = nil
        case let .list(key):
            components.host = "list"
            list = key
        case let .add(key):
            components.host = "add"
            list = key
        case let .ramble(key):
            components.host = "ramble"
            list = key
        }
        if let list { components.queryItems = [URLQueryItem(name: "list", value: list)] }
        return components.url!
    }
}
