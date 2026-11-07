import Foundation

/// Ports `shared/sharing.ts`.
public enum Sharing {
    /// Who the share sheet offers for `q`: people the space has already met match at once, and the server's answer for
    /// the same query joins them once it lands. Neither offers this user or anyone the list is already shared with.
    public static func suggestions(
        q: String,
        me: String?,
        known: [Person],
        found: (q: String, people: [Person])?,
        granted: [String]
    ) -> [Person] {
        guard !q.isEmpty else { return [] }
        let local = known.filter { $0.id != me && namePrefixed($0.name, q) }
        let remote = found?.q == q ? found!.people : []
        let all = local + remote.filter { person in !local.contains { $0.id == person.id } }
        return all.filter { !granted.contains($0.id) }
    }

    static func namePrefixed(_ name: String, _ q: String) -> Bool {
        UTF16Text.hasPrefix(name.lowercased().utf16, q.lowercased().utf16)
    }
}
