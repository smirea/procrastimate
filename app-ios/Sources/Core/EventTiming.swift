import Foundation

/// The event picker's timing: an optional amount of a unit before or after the start or the end, or during the event.
/// Swift only, since only iOS picks events. It reads any stored edge and writes one edge per moment, so `at the end`
/// is always `beforeEnd` with no minutes.
public struct EventTiming: Equatable, Sendable {
    public enum Anchor: CaseIterable, Sendable { case start, during, end }
    public enum Direction: CaseIterable, Sendable { case before, after }
    public enum Unit: Int, CaseIterable, Sendable {
        case minutes = 1, hours = 60, days = 1440, weeks = 10080

        public var short: String {
            switch self {
            case .minutes: "m"
            case .hours: "h"
            case .days: "d"
            case .weeks: "w"
            }
        }
    }

    public var anchor: Anchor
    /// How many units away from the anchor; 0 is the anchor itself.
    public var amount: Int
    public var unit: Unit
    public var direction: Direction

    public init(anchor: Anchor = .start, amount: Int = 0, unit: Unit = .minutes, direction: Direction = .before) {
        self.anchor = anchor
        self.amount = amount
        self.unit = unit
        self.direction = direction
    }

    /// A stored edge, its minutes in the largest unit they divide into: 300 reads `5h`, 90 reads `90m`.
    public init(edge: EventEdge, minutes: Int) {
        let (anchor, direction): (Anchor, Direction) = switch edge {
        case .before, .start: (.start, .before)
        case .afterStart: (.start, .after)
        case .during: (.during, .before)
        case .beforeEnd: (.end, .before)
        case .after: (.end, .after)
        }
        let taken = edge == .start || edge == .during ? 0 : minutes
        let unit = taken == 0 ? .minutes : Unit.allCases.last { taken % $0.rawValue == 0 } ?? .minutes
        self.init(anchor: anchor, amount: taken / unit.rawValue, unit: unit, direction: direction)
    }

    public var minutes: Int { anchor == .during ? 0 : amount * unit.rawValue }

    public var edge: EventEdge {
        switch (anchor, direction) {
        case (.during, _): .during
        case (.start, _) where minutes == 0: .start
        case (.start, .before): .before
        case (.start, .after): .afterStart
        case (.end, .after) where minutes > 0: .after
        case (.end, _): .beforeEnd
        }
    }
}
