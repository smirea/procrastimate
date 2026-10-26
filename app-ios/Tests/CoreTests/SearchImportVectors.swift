import Core
import Foundation

@Sendable func csvVector(_ fn: String, _ a: Args) throws -> JSONValue {
    switch fn {
    case "parseCsv": return try json(CSV.parseCsv(a(0)))
    default: throw unknown(fn)
    }
}

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

@Sendable func linksVector(_ fn: String, _ a: Args) throws -> JSONValue {
    switch fn {
    case "linkify": return try json(Links.linkify(a(0), a(1, as: [Range<Int>]?.self) ?? []))
    default: throw unknown(fn)
    }
}

@Sendable func nameSearchVector(_ fn: String, _ a: Args) throws -> JSONValue {
    switch fn {
    case "sigilFragment":
        return try json(NameSearch.sigilFragment(a(0), a(1), a(2), a(3, as: [Project].self)))
    case "suggest": return try json(NameSearch.suggest(a(0, as: [Project].self), a(1), a(2)))
    case "unknownNames":
        return try json(NameSearch.unknownNames(a(0), a(1), a(2, as: [Project].self), a(3, as: [Project].self)))
    case "lastUsedProjects": return try json(NameSearch.lastUsed(a(0), NameSearch.projectIdsOf))
    case "lastUsedLabels": return try json(NameSearch.lastUsed(a(0), NameSearch.labelIdsOf))
    default: throw unknown(fn)
    }
}

private struct SuggestionDraft: Decodable {
    let projectId: String?
    let sectionId: String?
    let labelIds: [String]
    let location: TaskLocation?
}

private struct SuggestionAvailable: Decodable {
    let projectIds: [String]
    let sectionIds: [String]
    let labelIds: [String]
}

@Sendable func taskSuggestionsVector(_ fn: String, _ a: Args) throws -> JSONValue {
    switch fn {
    case "suggestionWords": return try json(TaskSuggestions.words(a(0)))
    case "pills":
        let draft: SuggestionDraft = try a(3)
        let available: SuggestionAvailable = try a(4)
        let suggestions = TaskSuggestions.suggest(TaskSuggestions.index(try a(0)), try a(1), now: try a(2))
        return try json(TaskSuggestions.pills(
            suggestions,
            draft: .init(projectId: draft.projectId, sectionId: draft.sectionId, labelIds: draft.labelIds, location: draft.location),
            available: .init(
                projectIds: Set(available.projectIds),
                sectionIds: Set(available.sectionIds),
                labelIds: Set(available.labelIds)
            )
        ))
    default: throw unknown(fn)
    }
}

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
