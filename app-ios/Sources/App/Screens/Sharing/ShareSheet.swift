import Core
import Feedback
import SwiftUI
import UIKit

/// The toolbar's share button for something in the user's own space. Another space's owner decides who sees it, so
/// shared things show no button.
struct ShareButton: View {
    @Environment(Store.self) private var store
    let target: API.ShareTarget
    let name: String

    @State private var presented = false

    var body: some View {
        Button("Share", systemImage: "person.crop.circle.badge.plus") { presented = true }
            .sheet(isPresented: $presented) {
                ShareSheet(target: target, name: name)
                    .presentationDetents([.medium, .large])
            }
    }
}

/// A person's name over their email, where the search gave one.
private struct PersonLine: View {
    let person: Person
    let email: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            PersonName(person: person)
            if let email {
                Text(email)
                    .font(.caption)
                    .foregroundStyle(.muted)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

struct ShareSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(Store.self) private var store
    @Environment(SyncClient.self) private var sync
    @Environment(Toasts.self) private var toasts
    let target: API.ShareTarget
    let name: String

    private typealias Row = OptimisticList<API.ShareView>.Row

    @State private var shares = OptimisticList<API.ShareView>(key: \.id)
    @State private var loaded = false
    @State private var query = ""
    @State private var found: [Person] = []
    @State private var searched = ""
    @State private var role = API.Role.edit
    @State private var copied = false
    @State private var error: ErrorReport?

    private var link: Row? { shares.rows.first { $0.value.grantee == nil } }
    private var people: [Row] { shares.rows.filter { $0.value.grantee != nil } }

    /// Everyone, before anything is typed; the people this space has met match at once and the server's answer joins them.
    private var suggestions: [Person] {
        Sharing.suggestions(
            q: trimmedQuery,
            me: store.me,
            known: store.people,
            found: (searched, found),
            granted: people.compactMap(\.value.grantee?.id)
        )
    }

    var body: some View {
        NavigationStack {
            Form {
                linkSection
                addSection
                peopleSection
                if let error {
                    Section { ErrorText(report: error) }
                }
            }
            .scrollContentBackground(.hidden)
            .scrollDismissesKeyboard(.immediately)
            .background(.canvas)
            .navigationTitle("Share “\(name)”")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done", role: .confirm) { dismiss() }
                }
            }
            .animation(.snappy, value: shares.rows)
            .animation(.snappy, value: suggestions)
            .sensoryFeedback(.success, trigger: copied) { _, new in new }
            .task { await load() }
            .task(id: query) { await search() }
        }
        .overlay(alignment: .bottom) { ToastStack() }
        .feedback(self)
    }

    private var linkSection: some View {
        Section {
            Button {
                Task { await copyLink() }
            } label: {
                SwiftUI.Label(copied ? "Copied" : "Copy link", systemImage: copied ? "checkmark" : "link")
                    .contentTransition(.symbolEffect(.replace))
            }
            .disabled(!loaded)
            if let link, link.value.url == nil {
                PendingValue(label: "Making the link")
                Button("Stop sharing the link", role: .destructive) { Task { await remove(link) } }
            }
            if let url = link?.value.url.flatMap(URL.init(string:)) {
                ShareLink(item: url) {
                    SwiftUI.Label("Send link…", systemImage: "square.and.arrow.up")
                }
                Text(url.absoluteString)
                    .font(.footnote)
                    .foregroundStyle(.muted)
                    .textSelection(.enabled)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Button("Stop sharing the link", role: .destructive) {
                    if let link { Task { await remove(link) } }
                }
            }
        } header: {
            Text("Link")
        } footer: {
            Text("Anyone with the link can view, without signing in.")
        }
    }

    private var addSection: some View {
        Section("Add people") {
            Picker("Access", selection: $role) {
                Text("Can edit").tag(API.Role.edit)
                Text("Can view").tag(API.Role.view)
            }
            .pickerStyle(.segmented)
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets())
            TextField("Email or name", text: $query)
                .keyboardType(.emailAddress)
                .textContentType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .accessibilityLabel("Email or name")
            ForEach(suggestions) { person in
                Button {
                    add(person)
                } label: {
                    HStack {
                        PersonLine(person: person, email: email(of: person)).foregroundStyle(.ink)
                        Spacer()
                        Image(systemName: "plus.circle.fill").foregroundStyle(.accent)
                    }
                    .frame(minHeight: 44)
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Add \(person.name)")
            }
            if suggestions.isEmpty, !trimmedQuery.isEmpty, searched == trimmedQuery {
                Text("No one by that name or email uses ProcrastiMate yet.")
                    .font(.footnote)
                    .foregroundStyle(.muted)
            }
        }
    }

    private var peopleSection: some View {
        Section("People with access") {
            if people.isEmpty {
                Text(loaded ? "Only you" : "Loading…").foregroundStyle(.muted)
            }
            ForEach(people) { row in
                if let person = row.value.grantee {
                    HStack {
                        PersonLine(person: person, email: email(of: person))
                        Spacer()
                        Text(row.value.role == .edit ? "Can edit" : "Can view")
                            .font(.subheadline)
                            .foregroundStyle(.muted)
                        Button {
                            Task { await remove(row) }
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .foregroundStyle(.faint)
                                .frame(width: 44, height: 44)
                                .contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Remove \(person.name)")
                    }
                }
            }
        }
    }

    /// A grantee comes without an email; the people the search returned carry theirs.
    private func email(of person: Person) -> String? {
        person.email ?? store.person(person.id)?.email
    }

    private var trimmedQuery: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }

    private func load() async {
        do {
            let all = try await APIClient.send(API.Endpoints.SharesList.self, NoInput())
            let mine = all.shares.filter { $0.target == target }
            shares.load(mine)
            store.rememberPeople(mine.compactMap(\.grantee))
            error = nil
        } catch {
            self.error = ErrorReport("Could not load who has access", error: error)
        }
        loaded = true
    }

    private func search() async {
        let q = trimmedQuery
        // An empty query lists everyone, asked at once so the sheet opens with them.
        if !q.isEmpty { try? await Task.sleep(for: .milliseconds(250)) }
        guard !Task.isCancelled,
              let people = try? await APIClient.send(API.Endpoints.PeopleSearch.self, NoInput(), query: ["q": q]),
              !Task.isCancelled else { return }
        found = people.people
        searched = q
    }

    /// The server shares only a target it holds, so one made a moment ago uploads first.
    private func create(_ audience: API.ShareAudience) async throws -> API.ShareView {
        await sync.flush()
        return try await APIClient.send(API.Endpoints.SharesCreate.self, API.NewShare(target: target, audience: audience))
    }

    private func placeholder(_ grantee: Person?, _ role: API.Role) -> API.ShareView {
        API.ShareView(id: "", target: target, grantee: grantee, role: role, createdAt: 0, url: nil)
    }

    private func copyLink() async {
        let row = link ?? shares.add(placeholder(nil, .view), failure: "Could not make a link", toasts: toasts) {
            try await create(.link)
        }
        // Stopping the link while it was made leaves nothing worth copying.
        guard let url = await shares.saved(row)?.url, link?.id == row.id else { return }
        UIPasteboard.general.string = url
        copied = true
        try? await Task.sleep(for: .seconds(1.5))
        copied = false
    }

    private func add(_ person: Person) {
        query = ""
        store.rememberPeople([person])
        let role = role
        shares.add(placeholder(person, role), failure: "Could not share with \(person.name)", toasts: toasts) {
            try await create(.user(userId: person.id, role: role))
        }
    }

    private func remove(_ row: Row) async {
        await shares.remove(row, failure: "Could not stop sharing", toasts: toasts) { share in
            _ = try await APIClient.send(API.Endpoints.SharesDelete.self, NoInput(), query: ["id": share.id])
        }
    }
}
