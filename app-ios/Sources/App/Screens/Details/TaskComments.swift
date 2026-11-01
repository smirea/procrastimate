import Core
import SwiftUI

/// A task's comments in its details: each with its author, time, and linked text, the user's own with edit and delete,
/// and a composer for anyone who may edit the task. Showing them reads them, including ones that arrive while open.
struct TaskComments: View {
    @Environment(Store.self) private var store
    @Environment(Toasts.self) private var toasts
    @Environment(\.space) private var space
    @Environment(\.clock) private var clock
    let task: TaskItem

    @State private var draft = ""
    @State private var editing: (id: String, body: String)?
    @FocusState private var composing: Bool
    @FocusState private var editingFocused: Bool

    var body: some View {
        let comments = store.comments(on: task.id)
        let editable = !store.isReadOnly(task.id)
        if !comments.isEmpty || editable {
            VStack(alignment: .leading, spacing: 8) {
                Text("Comments")
                    .font(.caption.weight(.semibold))
                    .textCase(.uppercase)
                    .foregroundStyle(.muted)
                    .accessibilityAddTraits(.isHeader)
                ForEach(comments) { comment in
                    row(comment, editable: editable)
                        .transition(.asymmetric(insertion: .move(edge: .bottom).combined(with: .opacity), removal: .opacity))
                }
                if editable { composer }
            }
            .padding(.horizontal, 4)
            .animation(.snappy, value: comments)
            .onChange(of: comments, initial: true) { markRead() }
            .task(id: unknownAuthors(comments)) { await learnAuthors(comments) }
        }
    }

    @ViewBuilder private func row(_ comment: Comment, editable: Bool) -> some View {
        let me = Session.userID
        let mine = me != nil && comment.authorId == me
        VStack(alignment: .leading, spacing: 3) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                author(comment, mine: mine).fontWeight(.medium)
                Text(ago(comment.createdAt)).font(.caption).foregroundStyle(.faint)
                if comment.editedAt != nil { Text("edited").font(.caption).foregroundStyle(.faint) }
                Spacer(minLength: 0)
            }
            .font(.subheadline)
            if editing?.id == comment.id {
                TextField("Edit comment", text: Binding(get: { editing?.body ?? "" }, set: { editing?.body = $0 }), axis: .vertical)
                    .lineLimit(1...)
                    .focused($editingFocused)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(.ink.opacity(0.04), in: .rect(cornerRadius: 12))
                    .onAppear { editingFocused = true }
                HStack {
                    Spacer()
                    Button("Cancel") { editing = nil }
                    Button("Save") { save() }.fontWeight(.semibold)
                }
                .font(.subheadline)
            } else {
                Links.text(comment.body)
                    .font(.subheadline)
                    .foregroundStyle(.ink)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .textSelection(.enabled)
            }
        }
        .padding(.vertical, 4)
        .contentShape(.rect)
        .contextMenu {
            if mine && editable {
                Button("Edit", systemImage: "pencil") { editing = (comment.id, comment.body) }
                Button("Delete", systemImage: "trash", role: .destructive) { delete(comment) }
            }
            Button("Copy", systemImage: "doc.on.doc") { UIPasteboard.general.string = comment.body }
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("comment-\(comment.body)")
        .accessibilityActions {
            if mine && editable {
                Button("Edit") { editing = (comment.id, comment.body) }
                Button("Delete") { delete(comment) }
            }
        }
    }

    private var composer: some View {
        HStack(alignment: .bottom, spacing: 8) {
            TextField("Add a comment", text: $draft, axis: .vertical)
                .lineLimit(1...12)
                .focused($composing)
                .font(.subheadline)
                .padding(.horizontal, 14)
                .padding(.vertical, 11)
                .background(.ink.opacity(0.04), in: .rect(cornerRadius: 20))
            Button(action: send) {
                Image(systemName: "paperplane.fill")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 44, height: 44)
                    .background(.accent, in: .circle)
            }
            .buttonStyle(.borderless)
            .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            .opacity(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? 0.35 : 1)
            .accessibilityLabel("Send comment")
        }
    }

    private func author(_ comment: Comment, mine: Bool) -> some View {
        let person = comment.authorId.flatMap(store.person)
            ?? (mine ? Person(id: comment.authorId ?? "", name: "You", kind: .human) : Person(id: "", name: "Someone", kind: .human))
        return PersonName(person: person, you: mine)
    }

    private func send() {
        guard let me = Session.userID else { return }
        if store.addComment(task.id, draft, by: me) != nil { draft = "" }
    }

    private func save() {
        if let me = Session.userID, let editing { store.editComment(editing.id, editing.body, by: me) }
        editing = nil
    }

    private func delete(_ comment: Comment) {
        guard let me = Session.userID, let removed = store.deleteComment(comment.id, by: me) else { return }
        toasts.show("Deleted comment", action: .init(label: "Undo") { store.undeleteComment(removed) })
    }

    private func markRead() {
        if let me = Session.userID { store.markCommentsRead(task.id, by: me) }
    }

    /// The authors the people cache cannot name yet, as a key that changes when a stranger's comment arrives.
    private func unknownAuthors(_ comments: [Comment]) -> [String] {
        Array(Set(comments.compactMap(\.authorId).filter { store.person($0) == nil && $0 != Session.userID })).sorted()
    }

    /// The people cache names authors offline; an author this device never met asks the server, also mid-visit.
    private func learnAuthors(_ comments: [Comment]) async {
        guard !unknownAuthors(comments).isEmpty,
              let listed = try? await APIClient.send(
                  API.Endpoints.CommentsList.self, NoInput(), query: ["space": space.query, "id": task.id]
              ) else { return }
        store.rememberPeople(listed.comments.map(\.author))
    }

    private func ago(_ at: Int) -> String {
        let date = Date(timeIntervalSince1970: Double(at) / 1000)
        let seconds = clock.now.timeIntervalSince(date)
        if abs(seconds) < 60 { return "just now" }
        if abs(seconds) < 86_400 { return date.formatted(.relative(presentation: .numeric, unitsStyle: .abbreviated)) }
        return date.formatted(.dateTime.month(.abbreviated).day())
    }
}
