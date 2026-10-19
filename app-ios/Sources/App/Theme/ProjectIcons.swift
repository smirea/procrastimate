import Core

extension ProjectIcon {
    /// The SF Symbol for each name in `shared/project-icons.ts`, drawing the same idea as the web's Phosphor glyph.
    var systemImage: String {
        switch self {
        case .home: "house"
        case .work: "briefcase"
        case .errands: "checklist"
        case .shopping: "cart"
        case .groceries: "basket"
        case .money: "banknote"
        case .bills: "receipt"
        case .health: "cross.case"
        case .fitness: "dumbbell"
        case .food: "fork.knife"
        case .travel: "airplane"
        case .car: "car"
        case .learning: "graduationcap"
        case .reading: "book"
        case .ideas: "lightbulb"
        case .writing: "pencil"
        case .code: "chevron.left.forwardslash.chevron.right"
        case .calendar: "calendar"
        case .family: "person.3"
        case .pets: "pawprint"
        case .garden: "leaf"
        case .cleaning: "bubbles.and.sparkles"
        case .repairs: "wrench.and.screwdriver"
        case .documents: "doc.text"
        case .email: "envelope"
        case .calls: "phone"
        case .music: "music.note"
        case .movies: "film"
        case .games: "gamecontroller"
        case .gifts: "gift"
        case .art: "paintbrush"
        case .photos: "camera"
        case .outdoors: "mountain.2"
        case .goals: "target"
        case .favorites: "star"
        case .love: "heart"
        case .someday: "moon"
        }
    }

    var title: String { rawValue.prefix(1).uppercased() + rawValue.dropFirst() }
}

extension Project {
    /// A project without an icon keeps the `#` it always had.
    var systemImage: String { icon?.systemImage ?? "number" }
}
