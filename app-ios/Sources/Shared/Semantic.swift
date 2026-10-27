import Core
import SwiftUI

extension Priority {
    var tone: Color {
        switch self {
        case .p1: .p1
        case .p2: .p2
        case .p3: .p3
        case .p4: .p4
        }
    }
}

extension Core.Label {
    /// A saved place is a label that holds a place, so it draws a pin wherever labels draw a tag.
    func systemImage(filled: Bool = false) -> String {
        place == nil ? filled ? "tag.fill" : "tag" : "mappin.and.ellipse"
    }
}

extension LabelColor {
    /// Text and the tag glyph.
    var tone: Color {
        switch self {
        case .red: .labelRed
        case .orange: .labelOrange
        case .amber: .labelAmber
        case .lime: .labelLime
        case .green: .labelGreen
        case .teal: .labelTeal
        case .cyan: .labelCyan
        case .blue: .labelBlue
        case .indigo: .labelIndigo
        case .violet: .labelViolet
        case .pink: .labelPink
        case .gray: .labelGray
        }
    }

    /// A label chip's capsule.
    var fill: Color {
        switch self {
        case .red: .labelRedFill
        case .orange: .labelOrangeFill
        case .amber: .labelAmberFill
        case .lime: .labelLimeFill
        case .green: .labelGreenFill
        case .teal: .labelTealFill
        case .cyan: .labelCyanFill
        case .blue: .labelBlueFill
        case .indigo: .labelIndigoFill
        case .violet: .labelVioletFill
        case .pink: .labelPinkFill
        case .gray: .labelGrayFill
        }
    }

    var name: String { rawValue.prefix(1).uppercased() + rawValue.dropFirst() }

    /// A filled circle that keeps its color inside a menu, which otherwise draws symbols in the menu's own color.
    var swatch: Image {
        let symbol = UIImage(systemName: "circle.fill")!
        return Image(uiImage: symbol.withTintColor(UIColor(tone), renderingMode: .alwaysOriginal))
    }
}

extension Format.DueTone {
    var color: Color {
        switch self {
        case .overdue: .toneOverdue
        case .today: .toneToday
        case .soon: .toneSoon
        case .week: .toneWeek
        case .later: .toneLater
        }
    }
}

extension QuickAdd.TokenKind {
    var tint: Color {
        switch self {
        case .due: .tokenDue
        case .priority: .tokenPriority
        case .reminder: .tokenReminder
        case .project, .section: .tokenProject
        case .recurrence: .tokenRecurrence
        case .label, .place: .tokenLabel
        }
    }
}
