import Core
import SwiftUI

struct PersonName: View {
    let person: Person
    var you = false

    var body: some View {
        HStack(spacing: 6) {
            Text(you ? "You" : person.name).lineLimit(1)
            if person.kind == .ai { AIBadge() }
        }
        .accessibilityElement(children: .combine)
    }
}

struct AIBadge: View {
    var body: some View {
        Text("AI")
            .font(.caption2.weight(.bold))
            .foregroundStyle(.accent)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(.accent.opacity(0.12), in: .capsule)
            .accessibilityLabel("AI account")
    }
}
