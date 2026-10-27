import Foundation

/// The quick add suggestion pills of `shared/task-suggestions.ts`: what similar past tasks were filed under. Words and
/// votes keep the web's insertion order, so float sums and ties come out the same.
public enum TaskSuggestions {
    public typealias Pill = API.SuggestionPill

    /// What similar past tasks agree on, and what the draft already holds.
    public typealias Fields = API.SuggestionFields
    public typealias Available = API.SuggestionAvailable

    public struct Index: Sendable {
        let tasks: [TaskItem]
        let words: [Set<String>]
        let norms: [Double]
        let idf: [String: Double]
    }

    private static let stopWords: Set<String> = ["a", "an", "the", "to", "for", "and", "of", "on", "with", "about", "my", "in", "at", "re", "from", "up"]
    private static let word = JSRegex(#"[\p{L}\p{N}]+"#)
    private static let neighbors = 8
    private static let recencyDays = 120.0
    private static let day = 86_400_000.0

    public static func words(_ text: String) -> [String] {
        var seen = Set<String>()
        var words: [String] = []
        for match in word.matches(in: text.lowercased()) {
            let value = match.value
            if stopWords.contains(value) { continue }
            let stem = value.utf16.count > 3 && value.hasSuffix("s") ? String(value.dropLast()) : value
            if seen.insert(stem).inserted { words.append(stem) }
        }
        return words
    }

    public static func index(_ tasks: [TaskItem]) -> Index {
        let ordered = tasks.map { words($0.title) }
        var counts: [String: Int] = [:]
        for list in ordered { for word in list { counts[word, default: 0] += 1 } }
        let idf = counts.mapValues { log(Double(tasks.count + 1) / Double($0)) }
        return Index(tasks: tasks, words: ordered.map { Set($0) }, norms: ordered.map { norm($0, idf) }, idf: idf)
    }

    private static func norm(_ words: [String], _ idf: [String: Double]) -> Double {
        sqrt(words.reduce(0) { $0 + pow(idf[$1] ?? 0, 2) })
    }

    /// The project, labels, and place that the eight past tasks sharing the most rare words with `title` agree on, each
    /// weighted by how closely and how recently it matches. A value shows only when the tasks that hold it carry at least
    /// half the vote, and a missing value votes too. Sections are never suggested; see `shared/task-suggestions.ts`.
    public static func suggest(_ index: Index, _ title: String, now: Int) -> Fields {
        let query = words(title)
        let queryNorm = norm(query, index.idf)
        guard queryNorm > 0 else { return Fields() }
        var scored: [(offset: Int, task: TaskItem, score: Double)] = []
        for (i, task) in index.tasks.enumerated() {
            let shared = query.reduce(0.0) { index.words[i].contains($1) ? $0 + pow(index.idf[$1]!, 2) : $0 }
            if shared == 0 { continue }
            let recency = exp(-Double(max(0, now - task.createdAt)) / day / recencyDays)
            scored.append((i, task, shared / (queryNorm * index.norms[i]) * (0.5 + 0.5 * recency)))
        }
        let near = scored.sorted { $0.score != $1.score ? $0.score > $1.score : $0.offset < $1.offset }.prefix(neighbors)
        let quorum = near.reduce(0) { $0 + $1.score } / 2

        func agreed(_ valuesOf: (TaskItem) -> [String]) -> [String] {
            var weights: [(value: String, weight: Double)] = []
            for (_, task, score) in near {
                for value in valuesOf(task) {
                    if let at = weights.firstIndex(where: { $0.value == value }) { weights[at].weight += score }
                    else { weights.append((value, score)) }
                }
            }
            return weights.enumerated()
                .filter { $0.element.weight >= quorum }
                .sorted { $0.element.weight != $1.element.weight ? $0.element.weight > $1.element.weight : $0.offset < $1.offset }
                .map(\.element.value)
        }
        // Two values can both hold exactly half the vote, and a tie suggests neither.
        func only(_ values: [String]) -> String? { values.count == 1 ? values[0] : nil }

        let projectId = only(agreed { $0.projectId.map { [$0] } ?? [] })
        let place = only(agreed { $0.location.map { [Triggers.placeKey($0)] } ?? [] })
        return Fields(
            projectId: projectId,
            labelIds: agreed(\.labelIds),
            location: place.flatMap { place in near.lazy.compactMap(\.task.location).first { Triggers.placeKey($0) == place } }
        )
    }

    /// The pills to show, in field order: each suggestion the draft can use and does not already hold.
    public static func pills(_ suggestions: Fields, draft: Fields, available: Available) -> [Pill] {
        var pills: [Pill] = []
        if let projectId = suggestions.projectId, available.projectIds.contains(projectId), draft.projectId != projectId {
            pills.append(.project(projectId: projectId))
        }
        for labelId in suggestions.labelIds where available.labelIds.contains(labelId) && !draft.labelIds.contains(labelId) {
            pills.append(.label(labelId: labelId))
        }
        if let location = suggestions.location, draft.location.map(Triggers.placeKey) != Triggers.placeKey(location) {
            pills.append(.place(location: location))
        }
        return pills
    }
}
