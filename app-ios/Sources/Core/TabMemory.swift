import Foundation

/// When each out-of-sight tab was last seen, so a tab left alone for `resetAfter` goes back to its root screen, scrolled
/// to the top, while it is still hidden. A tab is out of sight while another tab is open or the app is in the background.
public struct TabMemory<Tab: Hashable & Sendable>: Sendable {
    private var hiddenSince: [Tab: Date] = [:]

    public init() {}

    /// Keeps the earliest time, so the app going to the background doesn't restart a tab's clock.
    public mutating func hide(_ tab: Tab, at date: Date) {
        if hiddenSince[tab] == nil { hiddenSince[tab] = date }
    }

    public mutating func show(_ tab: Tab) {
        hiddenSince[tab] = nil
    }

    /// When the next hidden tab other than `kept` goes stale. Nil when none is hidden.
    public func nextReset(keeping kept: Tab? = nil) -> Date? {
        hiddenSince.filter { $0.key != kept }.values.min()?.addingTimeInterval(TabReset.after)
    }

    /// The tabs hidden for `TabReset.after` or longer, except `kept`. They come back at their root, so they are forgotten.
    public mutating func stale(at now: Date, keeping kept: Tab? = nil) -> Set<Tab> {
        let stale = Set(hiddenSince.filter { $0.key != kept && now.timeIntervalSince($0.value) >= TabReset.after }.keys)
        for tab in stale { hiddenSince[tab] = nil }
        return stale
    }
}

public enum TabReset {
    public static let after: TimeInterval = 30
}
