import Core
import Foundation

/// The widget data file in the app group the app and the widget extension share. The app is its only writer.
enum WidgetStore {
    static let group = "group.com.stefan.procrastimate"

    static let url: URL = {
        guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) else {
            fatalError("The \(group) app group is missing from this target's entitlements")
        }
        return container.appending(path: "widgets.json")
    }()

    static func read() -> WidgetData? {
        guard let bytes = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(WidgetData.self, from: bytes)
    }

    /// Returns whether the file changed, so the app reloads the widgets only then and keeps within their reload budget.
    static func write(_ data: WidgetData) throws -> Bool {
        let encoder = JSONEncoder()
        encoder.outputFormatting = .sortedKeys
        let bytes = try encoder.encode(data)
        if (try? Data(contentsOf: url)) == bytes { return false }
        try bytes.write(to: url, options: .atomic)
        return true
    }
}
