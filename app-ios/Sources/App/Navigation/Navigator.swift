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

    /// Opens what a share link points at in a space this user is already a member of, instead of the read-only
    /// page. Returns false when it is not theirs to open.
    func openShared(_ target: API.ShareTarget, in store: Store) -> Bool {
        switch target.kind {
        case .project where store.project(target.id) != nil:
            show(.project(id: target.id))
        case .label where store.label(target.id) != nil:
            show(.label(id: target.id))
        case .task where store.task(target.id) != nil:
            sheet = .details(taskID: target.id)
        default:
            return false
        }
        return true
    }

    private func show(_ route: Route) {
        sheet = nil
        tab = .browse
        paths[.browse] = [route]
    }
}
