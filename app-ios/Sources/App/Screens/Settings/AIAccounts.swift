import Core
import SwiftUI
import UIKit

/// Settings' AI accounts: each acts in the user's whole space through API tokens. A token shows once, right after it is
/// made, with Copy.
struct AIAccountsSection: View {
    @Environment(Store.self) private var store
    @Environment(Toasts.self) private var toasts

    /// The secret is only ever in the create response, so it lives here until Settings closes. Nil while it is made.
    private struct Token: Equatable {
        let rowID: String
        let attempt = UUID()
        var value: String?
        var prompt: String?
    }

    @State private var accounts = OptimisticList<Person>(key: \.id)
    @State private var loaded = false
    @State private var name = ""
    @State private var token: Token?
    @State private var copied: Copied?
    @State private var deleting: OptimisticList<Person>.Row?
    @State private var error: ErrorReport?

    var body: some View {
        Section {
            if loaded && accounts.rows.isEmpty {
                Text("None yet. An AI account can read and change your tasks with its token.")
                    .font(.subheadline)
                    .foregroundStyle(.muted)
            }
            ForEach(accounts.rows) { row in
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        PersonName(person: row.value)
                        Spacer()
                        Button("Generate token", systemImage: "key") { Task { await generate(row) } }
                            .labelStyle(.titleAndIcon)
                            .font(.subheadline)
                            .buttonStyle(.borderless)
                        Button("Delete \(row.value.name)", systemImage: "trash", role: .destructive) { deleting = row }
                            .labelStyle(.iconOnly)
                            .buttonStyle(.borderless)
                            .frame(minWidth: 44, minHeight: 44)
                    }
                    if let token, token.rowID == row.id {
                        TokenReveal(value: token.value, copied: copied) { what in
                            if let value = what == .token ? token.value : token.prompt { copy(value, as: what) }
                        }
                            .transition(.opacity.combined(with: .move(edge: .top)))
                    }
                }
            }
            HStack {
                TextField("New AI account", text: $name)
                    .submitLabel(.done)
                    .onSubmit { create() }
                    .accessibilityLabel("AI account name")
                Button("Create AI account", systemImage: "plus.circle.fill") { create() }
                    .labelStyle(.iconOnly)
                    .font(.title3)
                    .buttonStyle(.borderless)
                    .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
                    .frame(minWidth: 44, minHeight: 44)
            }
            if let error { ErrorText(report: error) }
        } header: {
            Text("AI accounts")
        }
        .animation(.snappy, value: accounts.rows)
        .animation(.snappy, value: token)
        .sensoryFeedback(.success, trigger: copied) { _, new in new != nil }
        .confirmationDialog(
            "Delete \(deleting?.value.name ?? "")? Its tokens stop working.",
            isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) {
                if let deleting { Task { await remove(deleting) } }
            }
        }
        .task { await load() }
    }

    private func load() async {
        do {
            let loaded = try await APIClient.send(API.Endpoints.AiList.self, NoInput()).accounts
            accounts.load(loaded)
            store.rememberPeople(loaded)
            error = nil
        } catch {
            self.error = ErrorReport("Could not load AI accounts", error: error)
        }
        loaded = true
    }

    private func create() {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        name = ""
        let owner = UserDefaults.standard.string(forKey: Session.ownerKey)
        accounts.add(Person(id: "", name: trimmed, kind: .ai, ownerId: owner), failure: "Could not create \(trimmed)", toasts: toasts) {
            let account = try await APIClient.send(API.Endpoints.AiCreate.self, API.AiCreateInput(name: trimmed))
            store.rememberPeople([account])
            return account
        }
    }

    private func generate(_ row: OptimisticList<Person>.Row) async {
        let pending = Token(rowID: row.id)
        token = pending
        copied = nil
        guard let account = await accounts.saved(row) else {
            if token == pending { token = nil }
            return
        }
        do {
            let created = try await APIClient.send(
                API.Endpoints.TokensCreate.self, API.NewApiToken(aiUserId: account.id, name: account.name)
            )
            if token == pending {
                token?.value = created.token
                token?.prompt = created.prompt
            }
        } catch {
            _ = ErrorReport("Could not make a token", error: error)
            guard token == pending else { return }
            token = nil
            toasts.show("Could not make a token")
        }
    }

    private func copy(_ value: String, as what: Copied) {
        UIPasteboard.general.string = value
        copied = what
        Task {
            try? await Task.sleep(for: .seconds(1.5))
            if copied == what { copied = nil }
        }
    }

    private func remove(_ row: OptimisticList<Person>.Row) async {
        if token?.rowID == row.id { token = nil }
        await accounts.remove(row, failure: "Could not delete \(row.value.name)", toasts: toasts) { account in
            _ = try await APIClient.send(API.Endpoints.AiDelete.self, NoInput(), query: ["id": account.id])
        }
    }
}

private enum Copied { case token, prompt }

private struct TokenReveal: View {
    let value: String?
    let copied: Copied?
    let copy: (Copied) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Copy it now. It will not be shown again.")
                .font(.caption)
                .foregroundStyle(.muted)
            HStack(spacing: 8) {
                if let value {
                    Text(value)
                        .font(.caption.monospaced())
                        .lineLimit(1)
                        .truncationMode(.middle)
                        .textSelection(.enabled)
                        .accessibilityLabel("Token")
                        .transition(.opacity)
                } else {
                    PendingValue(label: "Making a token")
                }
                Spacer(minLength: 4)
                Button { copy(.token) } label: {
                    SwiftUI.Label(
                        copied == .token ? "Copied" : "Copy",
                        systemImage: copied == .token ? "checkmark" : "doc.on.doc"
                    )
                    .contentTransition(.symbolEffect(.replace))
                }
                .font(.subheadline)
                .buttonStyle(.borderless)
                .disabled(value == nil)
            }
            .padding(10)
            .background(.ink.opacity(0.05), in: .rect(cornerRadius: 12))
            Button { copy(.prompt) } label: {
                SwiftUI.Label(
                    copied == .prompt ? "Copied" : "Copy prompt for your AI",
                    systemImage: copied == .prompt ? "checkmark" : "sparkles"
                )
                .contentTransition(.symbolEffect(.replace))
            }
            .font(.subheadline)
            .buttonStyle(.borderless)
            .disabled(value == nil)
            .accessibilityHint("Copies the token with where to find the API docs")
        }
    }
}
