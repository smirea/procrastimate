import Core
import Foundation

/// The widget data file in the app group the app and the widget extension share. The app writes it after every change,
/// and the extension only to check off a row.
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

    /// A widget's checkbox, from the extension: the row strikes through and the task completes in the file, before the
    /// app has started. The app's next write, with the task completed in its store, carries the struck row over.
    static func check(_ id: String) {
        let now = Date()
        guard let data = read(),
              let checked = data.checking(id, now: now, today: Dates.toDateKey(now, in: .current), in: .current)
        else { return }
        _ = try? write(checked)
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
