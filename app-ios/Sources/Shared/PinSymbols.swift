import Core

extension Pin {
    /// The symbol of a list that always exists, shared by its tab and its Browse row.
    var systemImage: String {
        switch self {
        case .inbox: "tray"
        case .tomorrow: "sunrise"
        case .thisWeek: "calendar.day.timeline.left"
        case .noDate: "calendar.badge.minus"
        case .project: "number"
        case .label: "tag"
        case .place: "mappin.and.ellipse"
        case .event: "calendar"
        }
    }
}
