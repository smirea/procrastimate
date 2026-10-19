import Core
import SwiftUI
import UIKit

/// The shell the picker chips share: a chip that opens its picker in a popover or a sheet, from a tap or from the `+`
/// menu's `openTrigger`, with a 44 pt hit area around the 32 pt capsule.
struct PickerChip<Label: View, Content: View>: View {
    enum Presentation {
        case popover
        case sheet
    }

    let label: String
    var openTrigger = 0
    var presentation = Presentation.popover
    var startsOpen = false
    /// Runs before the picker shows, as the repeat chip reads its anchor date then.
    var onOpen: () -> Void = {}
    @ViewBuilder let chip: () -> Label
    @ViewBuilder let content: (_ close: @escaping () -> Void) -> Content

    @State private var open: Bool

    init(
        label: String,
        openTrigger: Int = 0,
        presentation: Presentation = .popover,
        startsOpen: Bool = false,
        onOpen: @escaping () -> Void = {},
        @ViewBuilder chip: @escaping () -> Label,
        @ViewBuilder content: @escaping (_ close: @escaping () -> Void) -> Content
    ) {
        self.label = label
        self.openTrigger = openTrigger
        self.presentation = presentation
        self.startsOpen = startsOpen
        self.onOpen = onOpen
        self.chip = chip
        self.content = content
        _open = State(initialValue: startsOpen)
    }

    var body: some View {
        let button = Button { show() } label: { chip().contentShape(.rect.inset(by: -6)) }
            .buttonStyle(.plain)
            .accessibilityLabel(label)
            .onChange(of: openTrigger) { show() }
        switch presentation {
        case .popover:
            button.popover(isPresented: $open) {
                content { open = false }.presentationCompactAdaptation(.popover)
            }
        case .sheet:
            button.sheet(isPresented: $open) { content { open = false } }
        }
    }

    private func show() {
        onOpen()
        open = true
    }
}

/// A capsule with a quiet fill, since quick add is already glass.
struct Chip: View {
    let systemImage: String
    let text: String
    var tone: Color = .muted
    var iconTone: Color?
    /// Tints the capsule, as a set priority does.
    var fill: Color?
    /// Replaces the capsule's color outright, as a label's fill does.
    var background: Color?

    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: systemImage).imageScale(.small).foregroundStyle(iconTone ?? tone)
            if !text.isEmpty { Text(text).lineLimit(1) }
        }
        .font(.subheadline.weight(.medium))
        .foregroundStyle(tone)
        .padding(.horizontal, 10)
        .frame(minHeight: 32)
        .background(background ?? fill.map { $0.opacity(0.18) } ?? Color.ink.opacity(0.06), in: .capsule)
        .contentShape(.capsule)
        .transition(.scale(scale: 0.9).combined(with: .opacity))
    }
}

struct PriorityChip: View {
    let priority: Priority
    var iconOnly = false
    let onChange: @MainActor (Priority) -> Void

    var body: some View {
        Menu {
            Picker("Priority", selection: Binding(get: { priority }, set: onChange)) {
                ForEach(Priority.allCases, id: \.self) { level in
                    SwiftUI.Label { Text(Format.priorityLabel(level)) } icon: { level.flag }.tag(level)
                }
            }
            .pickerStyle(.inline)
        } label: {
            Chip(
                systemImage: priority == .p4 ? "flag" : "flag.fill",
                text: iconOnly ? "" : priority == .p4 ? "Priority" : "P\(priority.rawValue)",
                tone: priority == .p4 ? .muted : .ink,
                iconTone: priority == .p4 ? nil : priority.tone,
                fill: iconOnly && priority != .p4 ? priority.tone : nil
            )
            .contentShape(.rect.inset(by: -6))
        }
        .menuOrder(.fixed)
        .accessibilityLabel(Format.priorityLabel(priority))
    }
}

/// Where a task sits: a project, or Inbox, and a section of that project.
struct Place: Hashable {
    var projectId: String?
    var sectionId: String?
}

extension Store {
    /// `Project / Section`, the project alone, or `Inbox`.
    func placeName(_ projectId: String?, _ sectionId: String?) -> String {
        guard let project = project(projectId) else { return "Inbox" }
        guard let section = section(sectionId), section.projectId == project.id else { return project.name }
        return "\(project.name) / \(section.name)"
    }
}

/// The rows of a project menu. A project with sections opens a submenu that lists `No section` and each section,
/// since a menu cannot indent rows.
struct PlaceMenuContent: View {
    @Environment(Store.self) private var store
    @Environment(\.space) private var space
    let selection: Binding<Place>
    @Binding var creating: Bool
    /// A ramble entry has no section, so its picker lists projects only.
    var showsSections = true

    var body: some View {
        let projects = store.projects(in: space)
        let sections = showsSections ? store.data(in: space).sections : []
        let sectioned = { (project: Project) in sections.contains { $0.projectId == project.id } }
        Picker("Project", selection: selection) {
            SwiftUI.Label("Inbox", systemImage: "tray").tag(Place())
            ForEach(projects.filter { !sectioned($0) }) { project in
                SwiftUI.Label(project.name, systemImage: project.systemImage).tag(Place(projectId: project.id))
            }
        }
        .pickerStyle(.inline)
        ForEach(projects.filter(sectioned)) { project in
            Menu {
                Picker(project.name, selection: selection) {
                    SwiftUI.Label("No section", systemImage: project.systemImage).tag(Place(projectId: project.id))
                    ForEach(StoreRules.sectionsOf(sections, project.id)) { section in
                        SwiftUI.Label(section.name, systemImage: "rectangle.split.1x2")
                            .tag(Place(projectId: project.id, sectionId: section.id))
                    }
                }
                .pickerStyle(.inline)
            } label: {
                SwiftUI.Label(project.name, systemImage: selection.wrappedValue.projectId == project.id ? "checkmark" : project.systemImage)
            }
        }
        if space == .own { Button("New project…", systemImage: "plus") { creating = true } }
    }
}

struct ProjectChip: View {
    @Environment(Store.self) private var store
    let projectId: String?
    var sectionId: String?
    var showsSections = true
    let onChange: @MainActor (String?, String?) -> Void

    @State private var creating = false

    var body: some View {
        let name = store.placeName(projectId, sectionId)
        Menu {
            PlaceMenuContent(
                selection: Binding(
                    get: { Place(projectId: projectId, sectionId: sectionId) },
                    set: { onChange($0.projectId, $0.sectionId) }
                ),
                creating: $creating,
                showsSections: showsSections
            )
        } label: {
            Chip(systemImage: projectId == nil ? "tray" : store.project(projectId)?.systemImage ?? "number", text: name, tone: projectId == nil ? .muted : .ink)
                .contentShape(.rect.inset(by: -6))
        }
        .accessibilityLabel("Project \(name)")
        .newProjectPrompt(isPresented: $creating) { onChange($0, nil) }
    }
}

struct FlowLayout: Layout {
    var spacing: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(proposal.width ?? .infinity, subviews)
        return CGSize(width: proposal.width ?? rows.width, height: rows.height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let rows = arrange(bounds.width, subviews)
        for (index, origin) in rows.origins.enumerated() {
            subviews[index].place(at: CGPoint(x: bounds.minX + origin.x, y: bounds.minY + origin.y), proposal: .unspecified)
        }
    }

    private func arrange(_ width: CGFloat, _ subviews: Subviews) -> (origins: [CGPoint], width: CGFloat, height: CGFloat) {
        var origins: [CGPoint] = []
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0, widest: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > 0, x + size.width > width {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            origins.append(CGPoint(x: x, y: y))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
            widest = max(widest, x - spacing)
        }
        return (origins, widest, y + rowHeight)
    }
}

extension Priority {
    /// Menus draw SF Symbols as templates in the app's tint, so the flag is pre-colored to keep each level's color.
    var flag: Image {
        let symbol = UIImage(systemName: self == .p4 ? "flag" : "flag.fill")!
        return Image(uiImage: symbol.withTintColor(UIColor(tone), renderingMode: .alwaysOriginal))
    }
}
