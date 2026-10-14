import ActivityKit

/// The Live Activity a `During` place shows while Stefan is there, built into both the app and the widget extension.
struct PlaceActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var titles: [String]
    }

    /// `Triggers.placeKey`, so the app finds the activity for a place again.
    var key: String
    var placeName: String
}
