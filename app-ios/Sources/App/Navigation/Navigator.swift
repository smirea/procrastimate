import Core
import Foundation
import Observation

@MainActor @Observable
final class Navigator {
    var tab: AppTab = .inbox
    var paths: [AppTab: [Route]] = [:]
    var sheet: Sheet?
    /// Set just before opening quick add so the mic starts recording.
    var startRambleListening = false
    /// Asks Browse to focus its search field, as Cmd-K does. Browse clears it once focused.
    var focusSearch = false

    /// Quick add's defaults while it is open. It shows as an overlay attached to the keyboard, not as a sheet.
    var quickAdd: QuickAddDefaults? {
        if case let .quickAdd(defaults) = sheet { defaults } else { nil }
    }

    /// Quick add from the tab bar starts in the project or label on screen.
    var listDefaults: QuickAddDefaults {
        switch paths[tab]?.last {
        case let .project(id)?: QuickAddDefaults(projectId: id)
        case let .label(id)?: QuickAddDefaults(labelId: id)
        default: QuickAddDefaults()
        }
    }

    /// The task just added from quick add. Its list scrolls to it and the row flashes, then this clears.
    private(set) var revealed: String?

    /// Shows the list a new task lands in: the open list when it already shows the task, else its project, else Inbox
    /// when it has a day or No date when it has none.
    func reveal(_ task: TaskItem, today: DateKey, in zone: TimeZone) {
        let current = paths[tab]?.last
        switch current {
        case let .label(id)? where task.labelIds.contains(id): break
        case let .project(id)? where task.projectId == id: break
        default:
            if let projectId = task.projectId {
                tab = .browse
                paths[.browse] = [.project(id: projectId)]
            } else {
                tab = Triggers.scheduledDue(task, today, in: zone) == nil ? .noDate : .inbox
                paths[tab] = []
            }
        }
        revealed = task.id
        Task {
            try? await Task.sleep(for: .seconds(1.5))
            if revealed == task.id { revealed = nil }
        }
    }

    func showSearch() {
        sheet = nil
        paths[.browse] = []
        tab = .browse
        focusSearch = true
    }

    /// The task a `procrastimate://task/<id>` link names, such as one from NoteTorus.
    static func taskID(in url: URL) -> String? {
        guard url.scheme == "procrastimate", url.host() == "task", url.pathComponents.count == 2 else { return nil }
        return url.pathComponents[1]
    }
}
