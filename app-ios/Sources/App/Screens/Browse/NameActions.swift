import Core
import SwiftUI

/// The toolbar of a project or label screen. An own one gets its share button and its rename and delete menu, and a
/// label its colors in the same menu. A shared one names its owner instead, since only the owner changes it.
struct NameActions: ViewModifier {
    let noun: String
    let name: String
    let space: SpaceKey
    /// Nil for a saved place, since sharing goes by the tasks carrying a label and a place's tasks carry none.
    let share: API.ShareTarget?
    let deletePrompt: String
    var deleteMessage: String?
    let copy: () -> Void
    let rename: (String) -> Void
    var color: LabelColor?
    var recolor: ((LabelColor) -> Void)?
    let delete: () -> Void
    /// A project's screen adds sections from its menu.
    var addSection: ((String) -> Void)?

    @Environment(Store.self) private var store
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var renaming = false
    @State private var draft = ""
    @State private var confirmingDelete = false
    @State private var deleted = 0
    @AppStorage("showCompleted") private var showCompleted = false
    @State private var addingSection = false
    @State private var sectionName = ""

    private var title: String { noun.prefix(1).uppercased() + noun.dropFirst() }

    func body(content: Content) -> some View {
        content
            .navigationSubtitle(store.owner(of: space).map { "Shared by \($0.name)" } ?? "")
            .toolbar {
                if space == .own, let share {
                    ToolbarItem(placement: .primaryAction) {
                        ShareButton(target: share, name: name)
                    }
                }
                ToolbarItem(placement: .primaryAction) {
                    Menu {
                        if space == .own {
                            if let color, let recolor {
                                Picker("Color", selection: Binding(get: { color }, set: { next in
                                    withAnimation(.snappy) { recolor(next) }
                                })) {
                                    ForEach(LabelColor.allCases) { option in
                                        SwiftUI.Label { Text(option.name) } icon: { option.swatch }.tag(option)
                                    }
                                }
                                .pickerStyle(.menu)
                            }
                            Button("Rename", systemImage: "pencil") {
                                draft = name
                                renaming = true
                            }
                        }
                        if space == .own, addSection != nil {
                            Button("Add section", systemImage: "rectangle.split.1x2") {
                                sectionName = ""
                                addingSection = true
                            }
                        }
                        Button("Copy as Markdown", systemImage: "doc.on.doc") { copy() }
                        Toggle("Show completed", systemImage: "checkmark.circle", isOn: $showCompleted)
                        if space == .own {
                            Button("Delete \(noun)", systemImage: "trash", role: .destructive) {
                                confirmingDelete = true
                            }
                        }
                    } label: {
                        SwiftUI.Label("\(title) actions", systemImage: "ellipsis")
                    }
                }
            }
            .alert("Rename \(noun)", isPresented: $renaming) {
                TextField("\(title) name", text: $draft)
                    .submitLabel(.done)
                Button("Cancel", role: .cancel) {}
                Button("Rename") {
                    let trimmed = draft.trimmingCharacters(in: .whitespacesAndNewlines)
                    if !trimmed.isEmpty { withAnimation(.snappy) { rename(trimmed) } }
                }
                .keyboardShortcut(.defaultAction)
            }
            .alert("Add section", isPresented: $addingSection) {
                TextField("Section name", text: $sectionName)
                    .submitLabel(.done)
                Button("Cancel", role: .cancel) {}
                Button("Add") {
                    let trimmed = sectionName.trimmingCharacters(in: .whitespacesAndNewlines)
                    if !trimmed.isEmpty { withAnimation(.snappy) { addSection?(trimmed) } }
                }
                .keyboardShortcut(.defaultAction)
            }
            .confirmationDialog(deletePrompt, isPresented: $confirmingDelete, titleVisibility: .visible) {
                Button("Delete", role: .destructive) {
                    deleted += 1
                    dismiss()
                    // Deleting once the pop has played lets the row leave Browse in view instead of under the push.
                    Task {
                        try? await Task.sleep(for: .milliseconds(reduceMotion ? 0 : 350))
                        withAnimation(.snappy) { delete() }
                    }
                }
            } message: {
                if let deleteMessage { Text(deleteMessage) }
            }
            .sensoryFeedback(.impact(weight: .medium), trigger: deleted)
    }
}

extension View {
    func nameActions(
        noun: String,
        name: String,
        space: SpaceKey,
        share: API.ShareTarget?,
        deletePrompt: String,
        deleteMessage: String? = nil,
        copy: @escaping () -> Void,
        rename: @escaping (String) -> Void,
        color: LabelColor? = nil,
        recolor: ((LabelColor) -> Void)? = nil,
        delete: @escaping () -> Void,
        addSection: ((String) -> Void)? = nil
    ) -> some View {
        modifier(NameActions(
            noun: noun,
            name: name,
            space: space,
            share: share,
            deletePrompt: deletePrompt,
            deleteMessage: deleteMessage,
            copy: copy,
            rename: rename,
            color: color,
            recolor: recolor,
            delete: delete,
            addSection: addSection
        ))
    }
}
