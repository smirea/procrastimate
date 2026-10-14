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

    func showSearch() {
        sheet = nil
        paths[.browse] = []
        tab = .browse
        focusSearch = true
    }
}
