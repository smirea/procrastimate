import Foundation

/// Where an entity lives for life: the user's own space, or a space someone shared, named by its owner's id.
public enum SpaceKey: Hashable, Sendable {
    case own
    case shared(String)

    /// The `space` query a request for this space sends. The own space sends none.
    public var query: String? {
        if case let .shared(id) = self { id } else { nil }
    }
}

public enum SharedLinks {
    /// The token of a public share link, `https://procrastimate.stf.lol/s/<token>`, which Universal Links open in the
    /// app.
    public static func token(in url: URL) -> String? {
        let path = url.pathComponents
        guard url.scheme == "https", url.host() == "procrastimate.stf.lol", path.count == 3, path[1] == "s",
              !path[2].isEmpty else { return nil }
        return path[2]
    }
}

extension Browse {
    public struct SharedEntry: Hashable, Sendable, Identifiable {
        public enum Kind: Hashable, Sendable { case project, label, task }

        public let kind: Kind
        public let id: String
        public let name: String
        public let owner: Person
    }

    /// What Browse lists under "Shared with me", as the web sidebar does: each thing its owner shared with this user
    /// that is still there. A whole-space share lists the space's projects.
    public static func sharedEntries(_ spaces: [(id: String, section: SpaceSection)]) -> [SharedEntry] {
        spaces.flatMap { _, section in
            let owner = section.owner
            return section.targets.flatMap { target -> [SharedEntry] in
                switch target.kind {
                case .project:
                    section.projects.filter { $0.id == target.id }
                        .map { SharedEntry(kind: .project, id: $0.id, name: $0.name, owner: owner) }
                case .label:
                    section.labels.filter { $0.id == target.id }
                        .map { SharedEntry(kind: .label, id: $0.id, name: $0.name, owner: owner) }
                case .task:
                    section.tasks.filter { $0.id == target.id }
                        .map { SharedEntry(kind: .task, id: $0.id, name: $0.title, owner: owner) }
                case .space:
                    section.projects.map { SharedEntry(kind: .project, id: $0.id, name: $0.name, owner: owner) }
                }
            }
        }
    }
}

extension SyncEngine {
    /// Runs `body` on one shared space dressed as a document: the space's data, cursor, outbox, and epoch with this
    /// device's id and clock. Commits and responses then go through the same code as the user's own space, and the
    /// one device clock keeps advancing across every space.
    static func inSpace<R>(_ snapshot: inout Snapshot, _ id: String, _ body: (inout Snapshot) throws -> R) rethrows -> R? {
        guard var section = snapshot.spaces[id], let sync = snapshot.sync else { return nil }
        var lens = Snapshot(
            tasks: section.tasks,
            projects: section.projects,
            sections: section.sections,
            labels: section.labels,
            comments: section.comments,
            remindersCheckedAt: snapshot.remindersCheckedAt,
            sync: SyncSection(
                deviceId: sync.deviceId,
                cursor: section.cursor,
                outbox: section.outbox,
                clock: sync.clock,
                timeZone: sync.timeZone,
                dictation: sync.dictation,
                quickAddButtons: sync.quickAddButtons,
                epoch: section.epoch
            )
        )
        let result = try body(&lens)
        section.tasks = lens.tasks
        section.projects = lens.projects
        section.sections = lens.sections
        section.labels = lens.labels
        section.comments = lens.comments
        if let after = lens.sync {
            section.cursor = after.cursor
            section.outbox = after.outbox
            section.epoch = after.epoch
            snapshot.sync?.clock = after.clock
        }
        snapshot.spaces[id] = section
        return result
    }

    /// The body of `POST /api/sync?space=<id>`, with the scope hash the space last applied.
    public static func request(_ snapshot: Snapshot, space id: String) throws -> API.SyncRequest? {
        guard let section = snapshot.spaces[id] else { return nil }
        var copy = snapshot
        guard var body = try inSpace(&copy, id, { try request($0) }) ?? nil else { return nil }
        // An edit the server refuses can leave the view's hash as it was, and the empty answer would then keep the
        // refused edit on screen. Pending edits always ask for a fresh snapshot, as on the web.
        body.scope = section.outbox.isEmpty ? section.scope : ""
        return body
    }

    /// Applies a shared space's sync response, keeping the scope hash and the read-only ids it carries, and returns
    /// the ops the server rejected, or nil when it could not apply.
    public static func apply(_ snapshot: inout Snapshot, space id: String, response: API.SyncResponse, now: Int, nextOpId: () -> String) -> [SyncOp]? {
        let rejected = inSpace(&snapshot, id) { lens in apply(&lens, response: response, now: now, nextOpId: nextOpId) } ?? nil
        guard let rejected, var section = snapshot.spaces[id] else { return nil }
        switch response {
        case let .changes(page):
            if let scope = page.scope { section.scope = scope }
        case let .snapshot(full):
            section.scope = full.scope ?? ""
            section.readOnly = full.readOnly ?? []
            section.targets = full.targets ?? []
        }
        snapshot.spaces[id] = section
        return rejected
    }

    /// Adds a section for each space now shared with this user and drops the ones no longer shared. Owners join the
    /// people cache so their names show offline.
    public static func setSpaces(_ snapshot: inout Snapshot, _ spaces: [API.Space]) {
        let listed = Set(spaces.map(\.id))
        snapshot.spaces = snapshot.spaces.filter { listed.contains($0.key) }
        for space in spaces {
            if snapshot.spaces[space.id] == nil {
                snapshot.spaces[space.id] = SpaceSection(owner: space.owner, cursor: 0)
            } else {
                snapshot.spaces[space.id]?.owner = space.owner
            }
        }
        rememberPeople(&snapshot, spaces.map(\.owner))
    }

    /// Adds or renames people in the cache, keyed by id.
    public static func rememberPeople(_ snapshot: inout Snapshot, _ people: [Person]) {
        for person in people {
            if let index = snapshot.people.firstIndex(where: { $0.id == person.id }) {
                snapshot.people[index] = person
            } else {
                snapshot.people.append(person)
            }
        }
    }
}
