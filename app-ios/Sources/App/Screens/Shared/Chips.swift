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
    var truncation: Text.TruncationMode = .tail

    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: systemImage).imageScale(.small).foregroundStyle(iconTone ?? tone)
            if !text.isEmpty { Text(text).lineLimit(1).truncationMode(truncation) }
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

/// The project menu: Inbox and the projects, where a project with sections opens a submenu that lists `No section` and
/// each section, since a menu cannot indent rows, and `New project…`.
///
/// It is a UIKit menu built when it opens, laid over `label`. A SwiftUI `Menu` turned every project and section into a
/// UIKit menu item, icon included, on each update of the view around it while closed: with 60 projects that was about
/// 200 ms of every details open, and quick add paid it on each keystroke.
struct PlaceMenu<Label: View>: View {
    @Environment(Store.self) private var store
    @Environment(\.space) private var space
    @Environment(\.namesFromEverySpace) private var everySpace
    let selection: Place
    /// A ramble entry has no section, so its picker lists projects only.
    var showsSections = true
    let accessibilityLabel: String
    var accessibilityIdentifier: String?
    let onChange: @MainActor (Place) -> Void
    @ViewBuilder let label: () -> Label

    @State private var creating = false

    var body: some View {
        label()
            .accessibilityHidden(true)
            .overlay {
                MenuButton(accessibilityLabel: accessibilityLabel, accessibilityIdentifier: accessibilityIdentifier, items: items)
                    .padding(-6)
            }
            .newProjectPrompt(isPresented: $creating) { onChange(Place(projectId: $0)) }
    }

    private func items() -> [UIMenuElement] {
        let data = everySpace ? store.everySpace : store.data(in: space)
        let projects = everySpace ? data.projects : store.projects(in: space)
        let sections = showsSections ? data.sections : []
        let sectioned = Set(sections.map(\.projectId))
        let pick = { (title: String, image: String, place: Place) in
            UIAction(title: title, image: UIImage(systemName: image), state: place == selection ? .on : .off) { _ in onChange(place) }
        }
        let flat = [pick("Inbox", "tray", Place())]
            + projects.filter { !sectioned.contains($0.id) }.map { pick($0.name, $0.systemImage, Place(projectId: $0.id)) }
        var items: [UIMenuElement] = [UIMenu(options: [.displayInline, .singleSelection], children: flat)]
        for project in projects where sectioned.contains(project.id) {
            let rows = [pick("No section", project.systemImage, Place(projectId: project.id))]
                + StoreRules.sectionsOf(sections, project.id).map {
                    pick($0.name, "rectangle.split.1x2", Place(projectId: project.id, sectionId: $0.id))
                }
            let icon = selection.projectId == project.id ? "checkmark" : project.systemImage
            items.append(UIMenu(title: project.name, image: UIImage(systemName: icon), children: [
                UIMenu(options: [.displayInline, .singleSelection], children: rows),
            ]))
        }
        if everySpace || space == .own {
            items.append(UIAction(title: "New project…", image: UIImage(systemName: "plus")) { _ in creating = true })
        }
        return items
    }
}

/// A clear button that opens the menu `items` builds at that moment.
private struct MenuButton: UIViewRepresentable {
    let accessibilityLabel: String
    let accessibilityIdentifier: String?
    let items: @MainActor () -> [UIMenuElement]

    @MainActor final class Coordinator {
        var items: @MainActor () -> [UIMenuElement] = { [] }
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> UIButton {
        let button = UIButton(type: .system)
        button.showsMenuAsPrimaryAction = true
        let coordinator = context.coordinator
        button.menu = UIMenu(children: [UIDeferredMenuElement.uncached { completion in completion(coordinator.items()) }])
        return button
    }

    func updateUIView(_ button: UIButton, context: Context) {
        context.coordinator.items = items
        button.accessibilityLabel = accessibilityLabel
        button.accessibilityIdentifier = accessibilityIdentifier
    }
}

struct ProjectChip: View {
    @Environment(Store.self) private var store
    let projectId: String?
    var sectionId: String?
    var showsSections = true
    let onChange: @MainActor (String?, String?) -> Void

    var body: some View {
        let name = store.placeName(projectId, sectionId)
        PlaceMenu(
            selection: Place(projectId: projectId, sectionId: sectionId),
            showsSections: showsSections,
            accessibilityLabel: "Project \(name)",
            onChange: { onChange($0.projectId, $0.sectionId) }
        ) {
            Chip(systemImage: projectId == nil ? "tray" : store.project(projectId)?.systemImage ?? "number", text: name, tone: projectId == nil ? .muted : .ink)
        }
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
