import Core
import SwiftUI

/// Values similar past tasks were filed under, offered under the title. A tap sets one, and its pill goes.
struct SuggestionPills: View {
    @Environment(Store.self) private var store
    let pills: [TaskSuggestions.Pill]
    let onPick: (TaskSuggestions.Pill) -> Void

    var body: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 6) {
                ForEach(pills, id: \.self) { pill in
                    let shown = describe(pill)
                    Button { onPick(pill) } label: {
                        HStack(spacing: 5) {
                            Image(systemName: shown.systemImage).imageScale(.small)
                            Text(shown.name).lineLimit(1)
                        }
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(shown.tone)
                        .padding(.horizontal, 10)
                        .frame(minHeight: 30)
                        // Dashed and unfilled, so an offer reads apart from the chips of what the task already holds.
                        .overlay { Capsule().strokeBorder(shown.tone.opacity(0.45), style: StrokeStyle(lineWidth: 1, dash: [3, 3])) }
                        .frame(minHeight: 44)
                        .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Suggested \(shown.kind) \(shown.name)")
                    .transition(.scale(scale: 0.9).combined(with: .opacity))
                }
            }
        }
        .scrollIndicators(.hidden)
        .padding(.vertical, -6)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Suggestions")
    }

    private func describe(_ pill: TaskSuggestions.Pill) -> (kind: String, name: String, systemImage: String, tone: Color) {
        switch pill {
        case let .project(projectId):
            let project = store.project(projectId)
            return ("project", project?.name ?? "", project?.systemImage ?? "number", .muted)
        case let .section(_, sectionId):
            return ("section", store.section(sectionId)?.name ?? "", "rectangle.split.1x2", .muted)
        case let .label(labelId):
            let label = store.label(labelId)
            return ("label", label?.name ?? "", label?.systemImage(filled: true) ?? "tag", label?.color.tone ?? .toneLabel)
        case let .place(location):
            return ("place", location.name, "mappin", .muted)
        }
    }
}
