import Core
import SwiftUI

/// A task list on the tinted canvas with its empty state. The title stays out of the way until the list scrolls, then
/// shows small in the bar. Quick add opens from the tab bar's add button with the list's defaults.
struct TaskListScreen<Content: View>: View {
    let title: String
    let isEmpty: Bool
    let emptyTitle: String
    let emptyHint: String
    /// At a tab's root this list has no back button, so it drops the bar and floats the title over the scroll edge
    /// instead. Pushed from Browse it keeps the bar.
    var root = false
    /// Shows a sort button at the top right that flips this.
    var newestFirst: Binding<Bool>?
    /// A label screen leads its title with the label's tag in its color, or a pin for a saved place.
    var labelColor: LabelColor?
    var labelIcon = "tag.fill"
    /// The open rows the list shows, for the count beside the title.
    var open: Int?
    /// The whole list as Markdown, for a copy button at the top right. Project and label screens copy from their menu
    /// instead.
    var markdown: Markdown.Document?
    @ViewBuilder let content: () -> Content

    @Environment(Navigator.self) private var navigator
    @Environment(AccountSync.self) private var accountSync
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.tabRoot) private var tabRoot
    @State private var scrolled = false

    private var floats: Bool { root && tabRoot }

    var body: some View {
        ScrollViewReader { proxy in
            List {
                content()
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                    .listSectionSeparator(.hidden)
                    .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))
            }
            // Every list in every tab stays alive, so each tries; only the one holding the row moves.
            .task(id: navigator.revealed) {
                guard let id = navigator.revealed else { return }
                try? await Task.sleep(for: .milliseconds(300))
                withAnimation(reduceMotion ? nil : .snappy) { proxy.scrollTo(id, anchor: .center) }
            }
        }
        .listStyle(.plain)
        .refreshable { await accountSync.refresh() }
        .safeAreaInset(edge: .top, spacing: 0) {
            if newestFirst != nil || (floats && markdown != nil) {
                HStack(spacing: 8) {
                    if floats, let markdown { FloatingCopyButton(document: markdown) }
                    if let newestFirst { SortButton(newestFirst: newestFirst) }
                }
                .frame(maxWidth: .infinity, alignment: .trailing)
                .padding(.horizontal, 16)
                .padding(.bottom, 4)
            }
        }
        .environment(\.defaultMinListRowHeight, 0)
        .scrollContentBackground(.hidden)
        .background { CanvasBackground() }
        .overlay {
            if isEmpty {
                ListEmptyState(title: emptyTitle, hint: emptyHint)
                    .transition(.opacity)
            }
        }
        .animation(.snappy, value: isEmpty)
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) { compactTitle }
            if !floats, let markdown {
                ToolbarItem(placement: .primaryAction) { CopyMarkdownButton(document: markdown) }
            }
        }
        .toolbarVisibility(floats ? .hidden : .automatic, for: .navigationBar)
        .overlay(alignment: .top) {
            if floats { compactTitle.offset(y: -6) }
        }
        .onScrollGeometryChange(for: Bool.self) { $0.contentOffset.y + $0.contentInsets.top > 4 } action: { _, value in
            scrolled = value
        }
    }

    /// A pushed list always names itself between the back and actions buttons; a root list only once scrolled.
    private var compactTitle: some View {
        HStack(spacing: 5) {
            // The navigation title already names the list, so only the count stays for VoiceOver.
            Group {
                if let labelColor {
                    Image(systemName: labelIcon).imageScale(.small).foregroundStyle(labelColor.tone)
                }
                Text(title)
            }
            .accessibilityHidden(true)
            if let open { PendingCount(open: open, font: .footnote) }
        }
            .font(.subheadline.weight(.semibold))
            .lineLimit(1)
            .opacity(scrolled || !floats ? 1 : 0)
            .animation(.snappy(duration: 0.2), value: scrolled)
    }
}

/// A tab's root list has no bar, so its copy button floats in glass beside the sort button.
private struct FloatingCopyButton: View {
    @Environment(TaskActions.self) private var actions
    let document: Markdown.Document

    var body: some View {
        Button { actions.copyAsMarkdown(document) } label: {
            Image(systemName: "doc.on.doc")
                .font(.subheadline.weight(.medium))
                .frame(width: 44, height: 44)
                .contentShape(.circle)
                .glassEffect(.regular.interactive(), in: .circle)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Copy as Markdown")
    }
}

private struct SortButton: View {
    @Binding var newestFirst: Bool

    var body: some View {
        Button {
            newestFirst.toggle()
        } label: {
            SwiftUI.Label(newestFirst ? "Newest" : "Oldest", systemImage: newestFirst ? "arrow.down" : "arrow.up")
                .font(.subheadline.weight(.medium))
                .contentTransition(.symbolEffect(.replace))
                .padding(.horizontal, 14)
                .frame(minHeight: 44)
                .contentShape(.capsule)
                .glassEffect(.regular.interactive(), in: .capsule)
        }
        .buttonStyle(.plain)
        .sensoryFeedback(.selection, trigger: newestFirst)
        .accessibilityLabel(newestFirst ? "Sorted newest first" : "Sorted oldest first")
        .accessibilityHint("Flips the sort")
    }
}

/// The web's page background: the canvas with a warm glow at the top left and a cool one at the top right, fixed to
/// the screen like the web's `background-attachment: fixed`.
struct CanvasBackground: View {
    var body: some View {
        Color.canvas
            .overlay { glow(.canvasGlowWarm, at: UnitPoint(x: 0.1, y: -0.1), width: 1200, height: 600) }
            .overlay { glow(.canvasGlowCool, at: UnitPoint(x: 1, y: 0), width: 900, height: 500) }
            .ignoresSafeArea()
    }

    private func glow(_ color: Color, at center: UnitPoint, width: CGFloat, height: CGFloat) -> some View {
        RadialGradient(colors: [color, color.opacity(0)], center: center, startRadius: 0, endRadius: width * 0.6)
            .scaleEffect(x: 1, y: height / width, anchor: center)
    }
}

struct ListHeading: View {
    @Environment(TaskActions.self) private var actions
    @Environment(Store.self) private var store
    @Environment(Navigator.self) private var navigator

    let text: String
    var tone: Color = .ink
    let tasks: [TaskItem]
    /// Off for done tasks, which are not pending.
    var counted = true
    /// The screen this heading's `Add task` opens quick add on, such as its day in Inbox. Nil hides it.
    var addTo: ListScreen?

    var body: some View {
        // A plain List never shows a header's `.contextMenu`, so a long press opens this menu and a tap does nothing.
        Menu {
            if let addTo {
                Button("Add task", systemImage: "plus") {
                    navigator.sheet = .quickAdd(Screens.defaults(addTo, store.tasks))
                }
            }
            Button("Copy as Markdown", systemImage: "doc.on.doc") {
                actions.copyAsMarkdown(Markdown.Document(sections: [.init(heading: text, tasks: tasks)]))
            }
        } label: {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(text)
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(tone)
                Spacer(minLength: 0)
                if counted { PendingCount(open: tasks.count) }
            }
            .textCase(nil)
            .contentShape(.rect)
        } primaryAction: {}
        .buttonStyle(.plain)
        .accessibilityAddTraits(.isHeader)
        .accessibilityIdentifier("heading-\(text)")
    }
}

struct CopyMarkdownButton: View {
    @Environment(TaskActions.self) private var actions
    let document: Markdown.Document

    var body: some View {
        Button("Copy as Markdown", systemImage: "doc.on.doc") { actions.copyAsMarkdown(document) }
    }
}

/// A list's open rows as small faint text, shown only when `Views.pendingCount` says the list is long enough. The number
/// rolls to its new value, and its digits keep one width so nothing beside it moves.
struct PendingCount: View {
    let open: Int
    var font: Font = .caption

    var body: some View {
        if let count = Views.pendingCount(open) {
            Text("\(count)")
                .font(font.weight(.regular))
                .foregroundStyle(.faint)
                .monospacedDigit()
                .contentTransition(.numericText(value: Double(count)))
                .animation(.snappy, value: count)
                .accessibilityLabel("\(count) open tasks")
        }
    }
}
