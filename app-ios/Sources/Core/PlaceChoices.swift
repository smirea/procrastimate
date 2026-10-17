import Foundation

/// What the Location sheet offers before anything is typed: the places used most recently, every saved place, and the
/// other places tasks have used. Only iOS picks places, so this rule has no TypeScript source.
public enum PlaceChoices {
    public static let recentLimit = 3
    public static let otherLimit = 20

    /// A place picked on this device, kept so a place set on an old task still counts as recent.
    public struct RecentPick: Codable, Hashable, Sendable {
        public var location: TaskLocation
        public var at: Int

        public init(location: TaskLocation, at: Int) {
            self.location = location
            self.at = at
        }
    }

    public struct Choice: Hashable, Sendable, Identifiable {
        public var location: TaskLocation
        /// The saved place this is, if it is one.
        public var savedID: String?
        public var id: String { Triggers.placeKey(location) }
    }

    public struct Sections: Hashable, Sendable {
        public var recent: [Choice]
        public var saved: [Choice]
        public var other: [Choice]
    }

    /// Each place shows once, in the first section that takes it. A place was last used when a task at it was created
    /// or it was last picked here, whichever is later, and a saved place reads under its saved name and radius.
    public static func sections(_ tasks: [TaskItem], _ labels: [Label], picks: [RecentPick]) -> Sections {
        var used: [String: (location: TaskLocation, at: Int)] = [:]
        let sources = tasks.compactMap { task in task.location.map { ($0, task.createdAt) } } + picks.map { ($0.location, $0.at) }
        for (location, at) in sources {
            let key = Triggers.placeKey(location)
            if let seen = used[key], seen.at >= at { continue }
            used[key] = (location, at)
        }
        let saved = Browse.labelsByName(labels).compactMap { label in
            Triggers.placeLocation(label, .arrive).map { Choice(location: $0, savedID: label.id) }
        }
        let savedByKey = Dictionary(saved.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        let byUse = used.sorted { a, b in a.value.at != b.value.at ? a.value.at > b.value.at : a.key < b.key }
            .map { savedByKey[$0.key] ?? Choice(location: $0.value.location, savedID: nil) }
        let recent = Array(byUse.prefix(recentLimit))
        let shown = Set(recent.map(\.id))
        return Sections(
            recent: recent,
            saved: saved.filter { !shown.contains($0.id) },
            other: Array(byUse.dropFirst(recentLimit).filter { $0.savedID == nil }.prefix(otherLimit))
        )
    }

    /// Records a pick, newest first, one per place, keeping only as many as the sheet can show.
    public static func record(_ location: TaskLocation, at: Int, in picks: [RecentPick]) -> [RecentPick] {
        let key = Triggers.placeKey(location)
        let kept = picks.filter { Triggers.placeKey($0.location) != key }
        return Array(([RecentPick(location: location, at: at)] + kept).prefix(recentLimit + otherLimit))
    }
}
