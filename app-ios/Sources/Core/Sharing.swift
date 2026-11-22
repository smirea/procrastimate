import Foundation

/// Ports `shared/sharing.ts`.
public enum Sharing {
    /// Who the share sheet offers for `q`, everyone for an empty one: people the space has already met match at once,
    /// and the server's answer for the same query joins them once it lands, its copy winning since it carries the
    /// email. Neither offers this user, anyone the list is already shared with, or someone else's AI account, which the
    /// server names for bylines but never lets anyone else share with.
    public static func suggestions(
        q: String,
        me: String?,
        known: [Person],
        found: (q: String, people: [Person])?,
        granted: [String]
    ) -> [Person] {
        let offered = { (person: Person) in person.id != me && (person.kind != .ai || person.ownerId == me) }
        let remote = found?.q == q ? found!.people.filter(offered) : []
        let local = known
            .filter { offered($0) && matches($0, q) }
            .map { person in remote.first { $0.id == person.id } ?? person }
        let all = local + remote.filter { person in !local.contains { $0.id == person.id } }
        return all.filter { !granted.contains($0.id) }
    }

    /// A name or email prefix, and everyone for an empty query.
    static func matches(_ person: Person, _ q: String) -> Bool {
        q.isEmpty || namePrefixed(person.name, q) || person.email.map { namePrefixed($0, q) } == true
    }

    static func namePrefixed(_ name: String, _ q: String) -> Bool {
        UTF16Text.hasPrefix(name.lowercased().utf16, q.lowercased().utf16)
    }
}
