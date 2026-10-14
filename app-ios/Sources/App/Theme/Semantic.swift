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
        case .project: .tokenProject
        case .recurrence: .tokenRecurrence
        case .label: .tokenLabel
        }
    }
}
