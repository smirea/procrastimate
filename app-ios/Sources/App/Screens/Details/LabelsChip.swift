import Core
import SwiftUI

/// The labels chip and its popover, which stays open while labels are toggled or created, unlike a `Menu`.
struct LabelsChip: View {
    @Environment(Store.self) private var store
    let labelIds: [String]
    let onChange: ([String]) -> Void

    @State private var open = false

    var body: some View {
        let chosen = labelIds.compactMap(store.label)
        let names = chosen.map(\.name).joined(separator: ", ")
        Button {
            open = true
        } label: {
            Chip(
                systemImage: chosen.isEmpty ? "tag" : "tag.fill",
                text: chosen.isEmpty ? "Labels" : names,
                tone: chosen.isEmpty ? .muted : .ink,
                iconTone: .toneLabel
            )
            .frame(maxWidth: 260, alignment: .leading)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(chosen.isEmpty ? "Add labels" : "Labels \(names)")
        .popover(isPresented: $open) {
            LabelsPopover(labelIds: labelIds, onChange: onChange)
                .presentationCompactAdaptation(.popover)
        }
    }
}

private struct LabelsPopover: View {
    @Environment(Store.self) private var store
    let labelIds: [String]
    let onChange: ([String]) -> Void

    @State private var query = ""

    var body: some View {
        let options = NameSearch.suggest(store.labels, NameSearch.lastUsed(store.tasks, NameSearch.labelIdsOf), query)
        VStack(alignment: .leading, spacing: 0) {
            TextField("Find or create a label", text: $query)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.done)
                .onSubmit { if let first = options.first { choose(first) } }
                .padding(.horizontal, 12)
                .frame(minHeight: 40)
                .background(.ink.opacity(0.05), in: .capsule)
                .padding(.bottom, 6)
                .accessibilityLabel("Find or create a label")
            if options.isEmpty {
                Text("Type a name to create your first label.")
                    .font(.subheadline)
                    .foregroundStyle(.muted)
                    .padding(10)
            }
            ForEach(options, id: \.self) { option in
                row(option)
            }
        }
        .animation(.snappy(duration: 0.16), value: labelIds)
        .sensoryFeedback(.selection, trigger: labelIds)
        .padding(8)
        .frame(width: 280)
    }

    @ViewBuilder private func row(_ option: NameSearch.Suggestion<Core.Label>) -> some View {
        switch option {
        case let .existing(label):
            let checked = labelIds.contains(label.id)
            Button { choose(option) } label: {
                HStack(spacing: 10) {
                    Image(systemName: checked ? "tag.fill" : "tag").foregroundStyle(.toneLabel)
                    Text(label.name).foregroundStyle(.ink).lineLimit(1)
                    Spacer(minLength: 8)
                    if checked {
                        Image(systemName: "checkmark")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(.accent)
                            .transition(.scale(scale: 0.5).combined(with: .opacity))
                    }
                }
                .padding(.horizontal, 10)
                .frame(maxWidth: .infinity, minHeight: 44)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(label.name)
            .accessibilityAddTraits(checked ? .isSelected : [])
        case let .create(name):
            Button { choose(option) } label: {
                HStack(spacing: 10) {
                    Image(systemName: "plus").foregroundStyle(.accent)
                    Text("Create label “\(name)”").foregroundStyle(.ink).lineLimit(1)
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 10)
                .frame(maxWidth: .infinity, minHeight: 44)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Create label “\(name)”")
        }
    }

    private func choose(_ option: NameSearch.Suggestion<Core.Label>) {
        switch option {
        case let .create(name):
            onChange(labelIds + [store.addLabel(name).id])
            query = ""
        case let .existing(label):
            onChange(labelIds.contains(label.id) ? labelIds.filter { $0 != label.id } : labelIds + [label.id])
        }
    }
}
