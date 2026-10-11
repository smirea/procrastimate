import Foundation

/// The strings and order of the Browse tab and the project and label screens, matching the web sidebar and views.
public enum Browse {
    /// Labels alphabetically, ignoring case and accents in `en-US` collation, like the web sidebar's Labels section.
    public static func labelsByName(_ labels: [Label]) -> [Label] {
        labels.stableSorted { a, b in
            let order = UTF16Text.compareBase(a.name, b.name)
            return order == .orderedSame ? nil : order == .orderedAscending
        }
    }

    public static func deleteProjectPrompt(_ name: String, taskCount: Int) -> String {
        "Delete \(name) and its \(taskCount) task\(taskCount == 1 ? "" : "s")?"
    }

    public static func deleteLabelPrompt(_ name: String) -> String { "Delete \(name)?" }

    public static let deleteLabelMessage = "Its tasks stay, without the label."

    public static func projectEmptyHint(_ name: String) -> String { "Add one here, or type #\(name) in quick add." }

    public static func labelEmptyHint(_ name: String) -> String {
        "Type @\(name) in quick add, or pick it in a task's details."
    }

    /// A completed task's date line in search, such as `Completed Today`.
    public static func completedLine(_ completedAt: Int, today: DateKey, in zone: TimeZone) -> String {
        "Completed \(Format.formatDate(Dates.toDateKey(Date(epochMilliseconds: completedAt), in: zone), today))"
    }
}
