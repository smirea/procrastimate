import SwiftUI

struct NameActions: ViewModifier {
    let noun: String
    let name: String
    let deletePrompt: String
    var deleteMessage: String?
    let copy: () -> Void
    let rename: (String) -> Void
    let delete: () -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var renaming = false
    @State private var draft = ""
    @State private var confirmingDelete = false
    @State private var deleted = 0

    private var title: String { noun.prefix(1).uppercased() + noun.dropFirst() }

    func body(content: Content) -> some View {
        content
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Menu {
                        Button("Rename", systemImage: "pencil") {
                            draft = name
                            renaming = true
                        }
                        Button("Copy as Markdown", systemImage: "doc.on.doc") { copy() }
                        Button("Delete \(noun)", systemImage: "trash", role: .destructive) {
                            confirmingDelete = true
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
        deletePrompt: String,
        deleteMessage: String? = nil,
        copy: @escaping () -> Void,
        rename: @escaping (String) -> Void,
        delete: @escaping () -> Void
    ) -> some View {
        modifier(NameActions(
            noun: noun, name: name, deletePrompt: deletePrompt, deleteMessage: deleteMessage, copy: copy, rename: rename, delete: delete
        ))
    }
}
