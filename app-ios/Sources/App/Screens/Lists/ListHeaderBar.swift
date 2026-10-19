import Core
import SwiftUI

/// What a list's `…` menu runs. `ListHeader` decides which entries show and in what order; each entry it names needs
/// its handler here.
struct ListActions {
    /// What the list is, such as `project`, for the menu's name and its dialogs.
    var noun = "list"
    var name = ""
    var copy: () -> Void
    var share: API.ShareTarget?
    var showCompleted: Binding<Bool>?
    var newestFirst: Binding<Bool>?
    var addSection: ((String) -> Void)?
    var rename: ((String) -> Void)?
    var color: Binding<LabelColor>?
    var icon: Binding<ProjectIcon?>?
    var editPlace: (() -> Void)?
    var savePlace: (() -> Void)?
    var delete: Delete?

    struct Delete {
        let prompt: String
        var message: String?
        let run: () -> Deleted?
    }

    var title: String { noun.prefix(1).uppercased() + noun.dropFirst() }
}

/// The filter a list keeps on this device, by `ListFilters.filterKey`, so it opens filtered the way it was left.
@propertyWrapper struct StoredFilter: DynamicProperty {
    @AppStorage("listFilters") private var stored = Data()
    let key: String

    init(_ screen: ListScreen) { key = ListFilters.filterKey(screen) }

    private var all: [String: ListFilter] { (try? JSONDecoder().decode([String: ListFilter].self, from: stored)) ?? [:] }

    var wrappedValue: ListFilter {
        get { all[key] ?? .none }
        nonmutating set {
            var next = all
            next[key] = newValue.active ? newValue : nil
            stored = (try? JSONEncoder().encode(next)) ?? Data()
        }
    }

    var projectedValue: Binding<ListFilter> {
        Binding(get: { wrappedValue }, set: { wrappedValue = $0 })
    }
}

/// The filter at the top left of a list: who made a task and its priority, each choice with its count at its right.
/// The icon fills while any filter is on. A popover rather than a menu, so it stays open while the user picks several
/// choices and the counts line up.
struct FilterMenu: View {
    @Environment(Store.self) private var store
    @Binding var filter: ListFilter
    /// The list's open rows before filtering, which the counts read.
    let tasks: [TaskItem]
    var floating = false

    @State private var presented = false

    var body: some View {
        let options = ListFilters.filterOptions(tasks, filter, me: store.me)
        if !options.isEmpty || filter.active {
            Button { presented = true } label: {
                let icon = filter.active ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle"
                if floating {
                    Image(systemName: icon)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(filter.active ? .accent : .ink)
                        .frame(width: 44, height: 44)
                        .contentShape(.circle)
                        .glassEffect(.regular.interactive(), in: .circle)
                } else {
                    SwiftUI.Label("Filters", systemImage: icon).foregroundStyle(filter.active ? Color.accent : Color.ink)
                }
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Filters")
            .accessibilityValue(filter.active ? "On" : "Off")
            .accessibilityIdentifier("list-filters")
            .popover(isPresented: $presented) {
                FilterPanel(filter: $filter, options: options)
                    .presentationCompactAdaptation(.popover)
            }
        }
    }
}

private struct FilterPanel: View {
    @Environment(Store.self) private var store
    @Binding var filter: ListFilter
    let options: FilterOptions

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if !options.people.isEmpty {
                heading("Created by", on: filter.people != nil, group: .people)
                ForEach(options.people, id: \.value) { option in
                    let person = store.person(option.value)
                    row(selected: option.selected, count: option.count) {
                        update(ListFilters.toggleOption(filter, person: option.value))
                    } label: {
                        Image(systemName: person?.kind == .ai ? "sparkles" : "person").foregroundStyle(.muted)
                        if option.value == store.me {
                            Text("You")
                        } else {
                            PersonName(person: person ?? Person(id: option.value, name: "Someone", kind: .human))
                        }
                    }
                }
            }
            if !options.priorities.isEmpty {
                if !options.people.isEmpty { Divider().padding(.vertical, 6) }
                heading("Priority", on: filter.priorities != nil, group: .priorities)
                ForEach(options.priorities, id: \.value) { option in
                    row(selected: option.selected, count: option.count) {
                        update(ListFilters.toggleOption(filter, priority: option.value))
                    } label: {
                        option.value.flag
                        Text(Format.priorityLabel(option.value))
                    }
                }
            }
            if filter.active {
                Divider().padding(.vertical, 6)
                Button("Clear filters") { update(.none) }
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                    .padding(.horizontal, 12)
                    .contentShape(.rect)
                    .buttonStyle(.plain)
            }
        }
        .padding(.vertical, 8)
        .frame(width: 280)
        .sensoryFeedback(.selection, trigger: filter)
    }

    private func update(_ next: ListFilter) {
        withAnimation(.snappy) { filter = next }
    }

    private func heading(_ text: String, on: Bool, group: FilterGroup) -> some View {
        row(selected: on, count: nil) {
            update(ListFilters.toggleGroup(filter, group, options))
        } label: {
            Text(text).font(.subheadline.weight(.semibold)).foregroundStyle(.muted)
        }
    }

    private func row(
        selected: Bool, count: Int?, action: @escaping () -> Void, @ViewBuilder label: () -> some View
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: "checkmark")
                    .font(.footnote.weight(.bold))
                    .foregroundStyle(.accent)
                    .opacity(selected ? 1 : 0)
                    .frame(width: 16)
                label()
                Spacer(minLength: 8)
                if let count {
                    Text("\(count)").font(.subheadline).foregroundStyle(.muted).monospacedDigit()
                }
            }
            .lineLimit(1)
            .padding(.horizontal, 12)
            .frame(minHeight: 44)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// A list's `…` menu, laid out by its `ListHeader`: the entries every list shares, a divider, then the list's own.
struct ListActionsMenu: View {
    let header: ListHeader
    let actions: ListActions
    @Binding var dialog: ListDialog?
    var floating = false

    var body: some View {
        Menu {
            Section { ForEach(header.common, id: \.self, content: item) }
            Section { ForEach(header.specific, id: \.self, content: item) }
        } label: {
            if floating {
                Image(systemName: "ellipsis")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.ink)
                    .frame(width: 44, height: 44)
                    .contentShape(.circle)
                    .glassEffect(.regular.interactive(), in: .circle)
            } else {
                SwiftUI.Label("\(actions.title) actions", systemImage: "ellipsis")
            }
        }
        .accessibilityLabel("\(actions.title) actions")
        .accessibilityIdentifier("list-actions")
    }

    @ViewBuilder private func item(_ entry: API.HeaderItem) -> some View {
        switch entry {
        case .share:
            if actions.share != nil { Button("Share", systemImage: "person.crop.circle.badge.plus") { dialog = .share } }
        case .copy:
            Button("Copy as Markdown", systemImage: "doc.on.doc", action: actions.copy)
        case .showCompleted:
            if let shown = actions.showCompleted { Toggle("Show completed", systemImage: "checkmark.circle", isOn: shown) }
        case .sort:
            if let newestFirst = actions.newestFirst {
                Picker("Sort", selection: newestFirst) {
                    SwiftUI.Label("Newest first", systemImage: "arrow.down").tag(true)
                    SwiftUI.Label("Oldest first", systemImage: "arrow.up").tag(false)
                }
                .pickerStyle(.inline)
            }
        case .addSection:
            if actions.addSection != nil { Button("Add section", systemImage: "rectangle.split.1x2") { dialog = .addSection } }
        case .rename:
            if actions.rename != nil { Button("Rename", systemImage: "pencil") { dialog = .rename } }
        case .color:
            if let color = actions.color {
                Picker("Color", systemImage: "paintpalette", selection: Binding(get: { color.wrappedValue }, set: { next in
                    withAnimation(.snappy) { color.wrappedValue = next }
                })) {
                    ForEach(LabelColor.allCases) { option in
                        SwiftUI.Label { Text(option.name) } icon: { option.swatch }.tag(option)
                    }
                }
                .pickerStyle(.menu)
            }
        case .icon:
            if let icon = actions.icon {
                Picker("Icon", systemImage: icon.wrappedValue?.systemImage ?? "number", selection: Binding(get: { icon.wrappedValue }, set: { next in
                    withAnimation(.snappy) { icon.wrappedValue = next }
                })) {
                    SwiftUI.Label("No icon", systemImage: "number").tag(ProjectIcon?.none)
                    ForEach(ProjectIcon.allCases) { option in
                        SwiftUI.Label(option.title, systemImage: option.systemImage).tag(Optional(option))
                    }
                }
                .pickerStyle(.menu)
            }
        case .editPlace:
            if let editPlace = actions.editPlace { Button("Edit place", systemImage: "mappin.circle", action: editPlace) }
        case .savePlace:
            if let savePlace = actions.savePlace {
                Button("Save place", systemImage: "bookmark", action: savePlace).accessibilityIdentifier("save-place")
            }
        case .delete:
            if actions.delete != nil {
                Button("Delete \(actions.noun)", systemImage: "trash", role: .destructive) { dialog = .delete }
            }
        }
    }
}

enum ListDialog: Hashable {
    case share, rename, addSection, delete
}

/// The share sheet, the rename and add section alerts, and the delete confirmation the `…` menu opens.
struct ListDialogs: ViewModifier {
    let actions: ListActions
    @Binding var dialog: ListDialog?

    @Environment(TaskActions.self) private var taskActions
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var draft = ""
    @State private var deleted = 0

    private func shown(_ which: ListDialog) -> Binding<Bool> {
        Binding(get: { dialog == which }, set: { if !$0, dialog == which { dialog = nil } })
    }

    func body(content: Content) -> some View {
        content
            .sheet(isPresented: shown(.share)) {
                if let share = actions.share {
                    ShareSheet(target: share, name: actions.name)
                        .presentationDetents([.medium, .large])
                }
            }
            .alert("Rename \(actions.noun)", isPresented: shown(.rename)) {
                TextField("\(actions.title) name", text: $draft)
                    .submitLabel(.done)
                Button("Cancel", role: .cancel) {}
                Button("Rename") { commit(actions.rename) }
                    .keyboardShortcut(.defaultAction)
            }
            .alert("Add section", isPresented: shown(.addSection)) {
                TextField("Section name", text: $draft)
                    .submitLabel(.done)
                Button("Cancel", role: .cancel) {}
                Button("Add") { commit(actions.addSection) }
                    .keyboardShortcut(.defaultAction)
            }
            .confirmationDialog(actions.delete?.prompt ?? "", isPresented: shown(.delete), titleVisibility: .visible) {
                Button("Delete", role: .destructive) {
                    guard let delete = actions.delete else { return }
                    deleted += 1
                    dismiss()
                    // Deleting once the pop has played lets the row leave Browse in view instead of under the push.
                    Task {
                        try? await Task.sleep(for: .milliseconds(reduceMotion ? 0 : 350))
                        taskActions.toastDeleted(actions.name, withAnimation(.snappy) { delete.run() })
                    }
                }
            } message: {
                if let message = actions.delete?.message { Text(message) }
            }
            .onChange(of: dialog) { _, next in draft = next == .rename ? actions.name : "" }
            .sensoryFeedback(.impact(weight: .medium), trigger: deleted)
    }

    private func commit(_ run: ((String) -> Void)?) {
        let trimmed = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty { withAnimation(.snappy) { run?(trimmed) } }
    }
}

extension AppStorage where Value == Bool {
    /// `Show completed` is each project's and label's own, so turning it on in one leaves the others as they were.
    static func showCompleted(_ list: API.ShareTarget) -> AppStorage<Bool> {
        AppStorage(wrappedValue: false, "showCompleted.\(list.kind.rawValue).\(list.id)")
    }
}
