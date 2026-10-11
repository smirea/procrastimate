import Core
import Foundation

// MARK: csv.ts

@Sendable func csvVector(_ fn: String, _ a: Args) throws -> JSONValue {
    switch fn {
    case "parseCsv": return try json(CSV.parseCsv(a(0)))
    default: throw unknown(fn)
    }
}

// MARK: search.ts

private struct SearchNames: Decodable {
    let projects: [Project]
    let labels: [Label]
}

@Sendable func searchVector(_ fn: String, _ a: Args) throws -> JSONValue {
    switch fn {
    case "searchTerms": return try json(Search.searchTerms(a(0)))
    case "excerpt": return try json(Search.excerpt(a(0), lead: a(1, as: Int?.self) ?? 24))
    case "search":
        let names: SearchNames = try a(2)
        return try json(Search.search(a(0), a(1), projects: names.projects, labels: names.labels))
    default: throw unknown(fn)
    }
}

// MARK: name-search.ts

@Sendable func nameSearchVector(_ fn: String, _ a: Args) throws -> JSONValue {
    switch fn {
    case "sigilFragment":
        return try json(NameSearch.sigilFragment(a(0), a(1), a(2), a(3, as: [Project].self)))
    case "suggest": return try json(NameSearch.suggest(a(0, as: [Project].self), a(1), a(2)))
    case "lastUsedProjects": return try json(NameSearch.lastUsed(a(0), NameSearch.projectIdsOf))
    case "lastUsedLabels": return try json(NameSearch.lastUsed(a(0), NameSearch.labelIdsOf))
    default: throw unknown(fn)
    }
}

// MARK: todoist.ts

private struct MergeOptions: Decodable {
    let now: Int
}

@Sendable func todoistVector(_ fn: String, _ a: Args) throws -> JSONValue {
    switch fn {
    case "readTodoistDate":
        return try json(Todoist.readTodoistDate(a(0), a.date(1), in: a.zone))
    case "readTodoistBackup":
        return try json(Todoist.readTodoistBackup(a(0), a.date(1), in: a.zone))
    case "mergeBackup":
        // Every merge in the TS tests takes ids from a fresh `id-1`, `id-2`, … counter.
        var count = 0
        let result = Todoist.mergeBackup(try a(0), try a(1), newId: {
            count += 1
            return "id-\(count)"
        }, now: try a(2, as: MergeOptions.self).now)
        return object(["state": try json(result.data), "summary": try json(result.summary)])
    default: throw unknown(fn)
    }
}
