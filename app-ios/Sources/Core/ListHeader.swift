import Foundation

public typealias ListHeader = API.ListHeader

/// Ports `shared/list-header.ts`: one header for every list. The filter menu sits at the top left when the list has
/// one, a `Show completed` toggle sits just left of the `…` menu where the list shows completed tasks, and the `…` menu
/// at the top right leads with what every list shares, in one order, then the list's own entries
/// after a separator, with delete last.
public enum ListHeaders {
    /// A top-level list as its header sees it. `own` is false for a project or label another space shared with the
    /// user, which only its owner changes; `place` marks a label that is a saved place, and `saveable` an unsaved place
    /// whose tasks still name a spot to save.
    public enum List: Hashable, Sendable {
        case inbox, tomorrow, thisWeek, noDate, completed, event
        case project(own: Bool)
        case label(own: Bool, place: Bool)
        case place(saveable: Bool)
    }

    public static func listHeader(_ list: List) -> ListHeader {
        switch list {
        case .inbox, .tomorrow, .thisWeek, .event:
            ListHeader(filters: true, showCompleted: false, common: [.copy])
        case .noDate:
            ListHeader(filters: true, showCompleted: false, common: [.copy], specific: [.sort])
        case .completed:
            ListHeader(filters: false, showCompleted: false, common: [.copy])
        case let .project(own):
            own
                ? ListHeader(filters: true, showCompleted: true, common: [.share, .copy], specific: [.addSection, .rename, .icon, .delete])
                : ListHeader(filters: true, showCompleted: true, common: [.copy])
        case let .label(own, place):
            // Sharing goes by the tasks carrying a label, and a saved place's tasks carry none.
            !own
                ? ListHeader(filters: true, showCompleted: true, common: [.copy])
                : place
                ? ListHeader(filters: true, showCompleted: true, common: [.copy], specific: [.rename, .color, .editPlace, .delete])
                : ListHeader(filters: true, showCompleted: true, common: [.share, .copy], specific: [.rename, .color, .delete])
        case let .place(saveable):
            ListHeader(filters: true, showCompleted: false, common: [.copy], specific: saveable ? [.savePlace] : [])
        }
    }
}
