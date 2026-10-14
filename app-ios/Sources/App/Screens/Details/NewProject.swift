import Core
import SwiftUI

/// `New project…` at the end of a project menu. A menu cannot hold a text field, so the name is typed in an alert, like
/// Rename, and the new project is picked right away.
struct NewProjectPrompt: ViewModifier {
    @Environment(Store.self) private var store
    @Binding var isPresented: Bool
    let onCreate: (String) -> Void

    @State private var name = ""

    func body(content: Content) -> some View {
        content.alert("New project", isPresented: $isPresented) {
            TextField("Project name", text: $name)
            Button("Cancel", role: .cancel) { name = "" }
            Button("Create") {
                let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
                name = ""
                guard !trimmed.isEmpty else { return }
                onCreate(withAnimation(.snappy) { store.addProject(trimmed) }.id)
            }
        }
    }
}

extension View {
    func newProjectPrompt(isPresented: Binding<Bool>, onCreate: @escaping (String) -> Void) -> some View {
        modifier(NewProjectPrompt(isPresented: isPresented, onCreate: onCreate))
    }
}
