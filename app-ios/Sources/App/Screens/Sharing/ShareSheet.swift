import Core
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

/// Who can see a project, label, or task: a public link to copy or send, people added by email or from those the
/// space has met, each removable.
struct ShareSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(Store.self) private var store
    @Environment(AccountSync.self) private var accountSync
    let target: API.ShareTarget
    let name: String

    @State private var shares: [API.ShareView] = []
    @State private var loaded = false
    @State private var query = ""
    @State private var found: [Person] = []
    @State private var searched = ""
    @State private var role = API.Role.edit
    @State private var copied = false
    @State private var busy = false
    @State private var error: ErrorReport?

    private var link: API.ShareView? { shares.first { $0.grantee == nil } }
    private var people: [API.ShareView] { shares.filter { $0.grantee != nil } }

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
            .animation(.snappy, value: shares)
            .animation(.snappy, value: found)
            .sensoryFeedback(.success, trigger: copied) { _, new in new }
            .task { await load() }
            .task(id: query) { await search() }
        }
    }

    private var linkSection: some View {
        Section {
            Button {
                Task { await copyLink() }
            } label: {
                SwiftUI.Label(copied ? "Copied" : "Copy link", systemImage: copied ? "checkmark" : "link")
                    .contentTransition(.symbolEffect(.replace))
            }
            .disabled(busy)
            if let url = link?.url.flatMap(URL.init(string:)) {
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
            let granted = Set(people.compactMap(\.grantee?.id))
            ForEach(found.filter { !granted.contains($0.id) }) { person in
                Button {
                    Task { await add(person) }
                } label: {
                    HStack {
                        PersonName(person: person).foregroundStyle(.ink)
                        Spacer()
                        Image(systemName: "plus.circle.fill").foregroundStyle(.accent)
                    }
                    .frame(minHeight: 44)
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Add \(person.name)")
            }
            if found.isEmpty, searched.contains("@"), searched == trimmedQuery {
                Text("No one with that email uses ProcrastiMate yet.")
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
            ForEach(people) { share in
                if let person = share.grantee {
                    HStack {
                        PersonName(person: person)
                        Spacer()
                        Text(share.role == .edit ? "Can edit" : "Can view")
                            .font(.subheadline)
                            .foregroundStyle(.muted)
                        Button {
                            Task { await remove(share) }
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

    private var trimmedQuery: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }

    private func load() async {
        do {
            let all = try await APIClient.send(API.Endpoints.SharesList.self, NoInput())
            shares = all.shares.filter { $0.target == target }
            store.rememberPeople(shares.compactMap(\.grantee))
            error = nil
        } catch {
            self.error = ErrorReport("Could not load who has access", error: error)
        }
        loaded = true
    }

    private func search() async {
        let q = trimmedQuery
        guard !q.isEmpty else {
            found = []
            searched = ""
            return
        }
        try? await Task.sleep(for: .milliseconds(250))
        guard !Task.isCancelled,
              let people = try? await APIClient.send(API.Endpoints.PeopleSearch.self, NoInput(), query: ["q": q]),
              !Task.isCancelled else { return }
        found = people.people
        searched = q
    }

    private func copyLink() async {
        busy = true
        defer { busy = false }
        if link == nil {
            do {
                // The server shares only a target it holds, so one made a moment ago uploads first.
                await accountSync.flush()
                let created = try await APIClient.send(API.Endpoints.SharesCreate.self, API.NewShare(target: target, audience: .link))
                shares.append(created)
            } catch {
                self.error = ErrorReport("Could not make a link", error: error)
                return
            }
        }
        guard let url = link?.url else { return }
        UIPasteboard.general.string = url
        copied = true
        try? await Task.sleep(for: .seconds(1.5))
        copied = false
    }

    private func add(_ person: Person) async {
        do {
            await accountSync.flush()
            let created = try await APIClient.send(
                API.Endpoints.SharesCreate.self,
                API.NewShare(target: target, audience: .user(userId: person.id, role: role))
            )
            shares.append(created)
            store.rememberPeople([person])
            query = ""
            error = nil
        } catch {
            self.error = ErrorReport("Could not share with \(person.name)", error: error)
        }
    }

    private func remove(_ share: API.ShareView) async {
        do {
            _ = try await APIClient.send(API.Endpoints.SharesDelete.self, NoInput(), query: ["id": share.id])
            shares.removeAll { $0.id == share.id }
            error = nil
        } catch {
            self.error = ErrorReport("Could not stop sharing", error: error)
        }
    }
}
