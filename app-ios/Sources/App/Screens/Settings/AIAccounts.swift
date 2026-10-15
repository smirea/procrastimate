import Core
import SwiftUI
import UIKit

/// Settings' AI accounts: each acts in the user's whole space through API tokens. A token shows once, right after it is
/// made, with Copy.
struct AIAccountsSection: View {
    @Environment(Store.self) private var store

    @State private var accounts: [Person] = []
    @State private var loaded = false
    @State private var name = ""
    @State private var token: (accountID: String, value: String)?
    @State private var copied = false
    @State private var deleting: Person?
    @State private var error: ErrorReport?

    var body: some View {
        Section {
            if loaded && accounts.isEmpty {
                Text("None yet. An AI account can read and change your tasks with its token.")
                    .font(.subheadline)
                    .foregroundStyle(.muted)
            }
            ForEach(accounts) { account in
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        PersonName(person: account)
                        Spacer()
                        Button("Generate token", systemImage: "key") { Task { await generate(account) } }
                            .labelStyle(.titleAndIcon)
                            .font(.subheadline)
                            .buttonStyle(.borderless)
                        Button("Delete \(account.name)", systemImage: "trash", role: .destructive) { deleting = account }
                            .labelStyle(.iconOnly)
                            .buttonStyle(.borderless)
                            .frame(minWidth: 44, minHeight: 44)
                    }
                    if let token, token.accountID == account.id {
                        TokenReveal(value: token.value, copied: copied) { copy(token.value) }
                            .transition(.opacity.combined(with: .move(edge: .top)))
                    }
                }
            }
            HStack {
                TextField("New AI account", text: $name)
                    .submitLabel(.done)
                    .onSubmit { Task { await create() } }
                    .accessibilityLabel("AI account name")
                Button("Create AI account", systemImage: "plus.circle.fill") { Task { await create() } }
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
        .animation(.snappy, value: accounts)
        .animation(.snappy, value: token?.value)
        .sensoryFeedback(.success, trigger: copied) { _, new in new }
        .confirmationDialog(
            "Delete \(deleting?.name ?? "")? Its tokens stop working.",
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
            accounts = try await APIClient.send(API.Endpoints.AiList.self, NoInput()).accounts
            store.rememberPeople(accounts)
            error = nil
        } catch {
            self.error = ErrorReport("Could not load AI accounts", error: error)
        }
        loaded = true
    }

    private func create() async {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        do {
            let account = try await APIClient.send(API.Endpoints.AiCreate.self, API.AiCreateInput(name: trimmed))
            accounts.append(account)
            store.rememberPeople([account])
            name = ""
            error = nil
        } catch {
            self.error = ErrorReport("Could not create the AI account", error: error)
        }
    }

    private func generate(_ account: Person) async {
        do {
            let created = try await APIClient.send(
                API.Endpoints.TokensCreate.self, API.NewApiToken(aiUserId: account.id, name: account.name)
            )
            token = (account.id, created.token)
            copied = false
            error = nil
        } catch {
            self.error = ErrorReport("Could not make a token", error: error)
        }
    }

    private func copy(_ value: String) {
        UIPasteboard.general.string = value
        copied = true
        Task {
            try? await Task.sleep(for: .seconds(1.5))
            copied = false
        }
    }

    private func remove(_ account: Person) async {
        do {
            _ = try await APIClient.send(API.Endpoints.AiDelete.self, NoInput(), query: ["id": account.id])
            accounts.removeAll { $0.id == account.id }
            if token?.accountID == account.id { token = nil }
            error = nil
        } catch {
            self.error = ErrorReport("Could not delete \(account.name)", error: error)
        }
    }
}

private struct TokenReveal: View {
    let value: String
    let copied: Bool
    let copy: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Copy it now. It will not be shown again.")
                .font(.caption)
                .foregroundStyle(.muted)
            HStack(spacing: 8) {
                Text(value)
                    .font(.caption.monospaced())
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .textSelection(.enabled)
                    .accessibilityLabel("Token")
                Spacer(minLength: 4)
                Button(action: copy) {
                    SwiftUI.Label(copied ? "Copied" : "Copy", systemImage: copied ? "checkmark" : "doc.on.doc")
                        .contentTransition(.symbolEffect(.replace))
                }
                .font(.subheadline)
                .buttonStyle(.borderless)
            }
            .padding(10)
            .background(.ink.opacity(0.05), in: .rect(cornerRadius: 12))
        }
    }
}
