import Core
import Feetback
import SwiftUI

/// The task's GitHub issues and pull requests, each with its live title and state, opening GitHub on tap, and a chip
/// that attaches another from a pasted link. See `docs/decisions/integrations.md`.
struct GithubChips: View {
    let refs: [GithubRef]
    let locked: Bool
    let onChange: ([GithubRef]) -> Void

    @State private var adding = false
    @State private var pasted = ""

    var body: some View {
        if !refs.isEmpty || !locked {
            FlowLayout(spacing: 6) {
                ForEach(refs, id: \.self) { ref in
                    GithubChip(ref: ref, locked: locked) {
                        onChange(refs.filter { !Github.same($0, ref) })
                    }
                }
                if !locked {
                    Button {
                        pasted = ""
                        adding = true
                    } label: {
                        Chip(systemImage: "arrow.triangle.pull", text: refs.isEmpty ? "GitHub" : "")
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Add a GitHub issue or pull request")
                }
            }
            .animation(.snappy(duration: 0.16), value: refs)
            .alert("GitHub issue or pull request", isPresented: $adding) {
                TextField("Paste a link", text: $pasted)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
                Button("Attach") {
                    if let ref = Github.parseGithubRef(pasted) { onChange(Github.withGithubRef(refs, ref)) }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("A github.com link, or owner/repo#123")
            }
            .feedback(self)
        }
    }
}

private struct GithubChip: View {
    @Environment(\.openURL) private var openURL
    let ref: GithubRef
    let locked: Bool
    let remove: () -> Void

    var body: some View {
        let item = GithubItems.shared.item(ref)
        let kind = item?.kind ?? ref.kind
        HStack(spacing: 0) {
            Button {
                openURL(Github.githubUrl(GithubRef(repo: ref.repo, number: ref.number, kind: kind)))
            } label: {
                HStack(spacing: 5) {
                    Image(systemName: Self.symbol(kind, item?.state))
                        .imageScale(.small)
                        .foregroundStyle(Self.tone(kind, item?.state))
                    if let title = item?.title {
                        // The flow lays chips out at their ideal width, so a long title is capped here or it runs off screen.
                        Text(title).lineLimit(1).foregroundStyle(.ink).frame(maxWidth: 220, alignment: .leading)
                        Text("#\(ref.number)").foregroundStyle(.muted).fixedSize()
                    } else {
                        Text(Github.githubLabel(ref)).foregroundStyle(.ink)
                    }
                }
                .padding(.leading, 10)
                .padding(.trailing, locked ? 10 : 4)
                .frame(minHeight: 32)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Self.label(ref, kind, item))
            if !locked {
                Button(action: remove) {
                    Image(systemName: "xmark")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(.faint)
                        .padding(.leading, 4)
                        .padding(.trailing, 10)
                        .frame(minHeight: 32)
                        .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Remove \(Github.githubLabel(ref))")
            }
        }
        .font(.subheadline.weight(.medium))
        .background(Color.ink.opacity(0.06), in: .capsule)
        .transition(.scale(scale: 0.9).combined(with: .opacity))
        .feedback(self)
    }

    static func label(_ ref: GithubRef, _ kind: API.GithubKind, _ item: GithubItem?) -> String {
        let state = item?.state.map { $0.rawValue.capitalized }
        return [kind == .pull ? "Pull request \(Github.githubLabel(ref))" : "Issue \(Github.githubLabel(ref))", item?.title, state]
            .compactMap { $0 }
            .joined(separator: ", ")
    }

    static func symbol(_ kind: API.GithubKind, _ state: GithubState?) -> String {
        switch (kind, state) {
        case (_, nil): "arrow.triangle.pull"
        case (.pull, .merged?): "arrow.triangle.merge"
        case (.pull, _): "arrow.triangle.pull"
        case (.issue, .closed?): "checkmark.circle"
        case (.issue, _): "smallcircle.circle"
        }
    }

    /// GitHub draws a closed issue as done, in the merged purple, and a closed pull request in red.
    static func tone(_ kind: API.GithubKind, _ state: GithubState?) -> Color {
        switch state {
        case nil: .muted
        case .open?: .toneSoon
        case .draft?: .muted
        case .merged?: .toneWeek
        case .closed?: kind == .issue ? .toneWeek : .toneOverdue
        }
    }
}
