import Foundation
import FoundationModels
import NaturalLanguage

setvbuf(stdout, nil, _IOLBF, 0)

struct Meta: Codable, Equatable {
    var project: String?
    var section: String?
    var labels: [String] = []
    var place: String?
    var time: String?

    /// One pill per field value. A section pill names its project, so it is only right when both are.
    var pills: Set<String> {
        var s = Set(labels.map { "label:\($0)" })
        if let project { s.insert("project:\(project)") }
        if let project, let section { s.insert("section:\(project)/\(section)") }
        if let place { s.insert("place:\(place)") }
        if let time { s.insert("time:\(time)") }
        return s
    }
}

struct Task: Decodable {
    let title: String
    let day: Int
    let project: String?
    let section: String?
    let labels: [String]
    let place: String?
    let time: String?
    var meta: Meta { Meta(project: project, section: section, labels: labels, place: place, time: time) }
}

struct Fixture: Decodable {
    struct Project: Decodable { let name: String; let sections: [String] }
    let projects: [Project]
    let labels: [String]
    let places: [String]
    let history: [Task]
    let sets: [String: [Task]]
}

let fixtureURL = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "fixture.json")
let fixture = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: fixtureURL))
let history = fixture.history
let today = history.map(\.day).max()! + 1

// MARK: Nearest neighbors over the history, the non-LLM baseline and the LLM's retriever.

let stop: Set<String> = ["a", "an", "the", "to", "for", "and", "of", "on", "with", "about", "my", "in", "at", "re", "from", "up"]
func tokens(_ s: String) -> Set<String> {
    Set(s.lowercased().split(whereSeparator: { !$0.isLetter && !$0.isNumber }).map(String.init)
        .filter { !stop.contains($0) }
        .map { $0.count > 3 && $0.hasSuffix("s") ? String($0.dropLast()) : $0 })
}
let historyTokens = history.map { tokens($0.title) }
let idf: [String: Double] = {
    var df: [String: Int] = [:]
    for t in historyTokens { for w in t { df[w, default: 0] += 1 } }
    return df.mapValues { log(Double(history.count + 1) / Double($0)) }
}()
func norm(_ t: Set<String>) -> Double { sqrt(t.reduce(0) { $0 + pow(idf[$1] ?? 0, 2) }) }
let historyNorms = historyTokens.map(norm)

struct Neighbor { let task: Task; let score: Double }
func neighbors(_ text: String, k: Int = 8) -> [Neighbor] {
    let q = tokens(text), qn = norm(q)
    guard qn > 0 else { return [] }
    return zip(history, zip(historyTokens, historyNorms)).compactMap { task, th in
        let shared = q.intersection(th.0).reduce(0) { $0 + pow(idf[$1] ?? 0, 2) }
        guard shared > 0 else { return nil }
        // Recent filings count more, so a habit that changed (a new label, a new project) wins over the old one.
        let recency = exp(-Double(today - task.day) / 120)
        return Neighbor(task: task, score: shared / (qn * th.1) * (0.5 + 0.5 * recency))
    }
    .sorted { $0.score > $1.score }
    .prefix(k).map { $0 }
}

// MARK: The same vote over sentence embeddings, so `oat milk` finds `milk` and `FaceTime grandma` finds `call mom`.

nonisolated(unsafe) let embedder = NLEmbedding.sentenceEmbedding(for: .english)!
let historyVectors = history.map { embedder.vector(for: $0.title.lowercased()) ?? [] }
func cosine(_ a: [Double], _ b: [Double]) -> Double {
    guard a.count == b.count, !a.isEmpty else { return 0 }
    var dot = 0.0, na = 0.0, nb = 0.0
    for i in a.indices { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
    return dot / (sqrt(na) * sqrt(nb))
}
@MainActor func semanticNeighbors(_ text: String, k: Int = 8) -> [Neighbor] {
    guard let q = embedder.vector(for: text.lowercased()) else { return [] }
    return zip(history, historyVectors).map { task, v in
        let recency = exp(-Double(today - task.day) / 120)
        return Neighbor(task: task, score: pow(max(cosine(q, v), 0), 4) * (0.5 + 0.5 * recency))
    }
    .sorted { $0.score > $1.score }
    .prefix(k).map { $0 }
}

/// Each field's value when the neighbors that hold it carry at least `share` of the vote. A missing value votes too.
func vote(_ ns: [Neighbor], share: Double = 0.5) -> Meta {
    let total = ns.reduce(0) { $0 + $1.score }
    func top(_ value: (Task) -> String?) -> String? {
        var w: [String: Double] = [:]
        for n in ns { if let v = value(n.task) { w[v, default: 0] += n.score } }
        guard let best = w.max(by: { $0.value < $1.value }), best.value >= share * total else { return nil }
        return best.key
    }
    var m = Meta(project: top(\.project), place: top(\.place), time: top(\.time))
    if let p = m.project { m.section = top { $0.project == p ? $0.section : nil } }
    var lw: [String: Double] = [:]
    for n in ns { for l in n.task.labels { lw[l, default: 0] += n.score } }
    m.labels = lw.filter { $0.value >= share * total }.sorted { $0.value > $1.value }.map(\.key)
    return m
}

// MARK: The on-device model, constrained to names the user already has.

let model = SystemLanguageModel(guardrails: .permissiveContentTransformations)
let none = "none"
let sectionNames = fixture.projects.flatMap { p in p.sections.map { "\(p.name) / \($0)" } }
let times = Array(Set(history.compactMap(\.time))).sorted()
let schema = try GenerationSchema(root: DynamicGenerationSchema(name: "Suggestion", properties: [
    .init(name: "project", schema: .init(name: "Project", anyOf: fixture.projects.map(\.name) + [none])),
    .init(name: "section", schema: .init(name: "Section", anyOf: sectionNames + [none])),
    .init(name: "labels", schema: .init(arrayOf: .init(name: "Label", anyOf: fixture.labels), maximumElements: 3)),
    .init(name: "place", schema: .init(name: "Place", anyOf: fixture.places + [none])),
    .init(name: "time", schema: .init(name: "Time", anyOf: times + [none])),
]), dependencies: [])

let baseInstructions = """
    You suggest how to file a to-do the user is typing, from how this user filed earlier to-dos. \
    Pick a project, section, labels, place, and time only when the user's habits make it likely; otherwise answer none \
    or no labels. Most to-dos have no time and no place.
    """

func line(_ t: Task) -> String {
    var parts: [String] = []
    parts.append("project: \(t.project ?? none)")
    if let s = t.section { parts.append("section: \(t.project!) / \(s)") }
    if !t.labels.isEmpty { parts.append("labels: \(t.labels.joined(separator: ", "))") }
    if let p = t.place { parts.append("place: \(p)") }
    if let x = t.time { parts.append("time: \(x)") }
    return "\(t.title) → \(parts.joined(separator: "; "))"
}

/// Seconds a strategy spent waiting on purpose, such as for a prewarm, which the latency leaves out.
var idle = 0.0

@MainActor func ask(_ instructions: String, _ text: String, prewarm: Bool = false) async throws -> Meta {
    let session = LanguageModelSession(model: model, instructions: instructions)
    if prewarm {
        // Quick add would prewarm when it opens, well before the user pauses typing.
        session.prewarm()
        try await _Concurrency.Task.sleep(for: .seconds(2))
        idle += 2
    }
    let r = try await session.respond(to: "To-do: \(text)", schema: schema, options: GenerationOptions(samplingMode: .greedy))
    func field(_ name: String) throws -> String? {
        let v = try r.content.value(String.self, forProperty: name)
        return v == none ? nil : v
    }
    var m = Meta(project: try field("project"), labels: try r.content.value([String].self, forProperty: "labels"),
                 place: try field("place"), time: try field("time"))
    if let s = try field("section") {
        let parts = s.components(separatedBy: " / ")
        m.project = parts[0]
        m.section = parts[1]
    }
    return m
}

let catalog = """
    Projects and sections: \(fixture.projects.map { $0.sections.isEmpty ? $0.name : "\($0.name) (\($0.sections.joined(separator: ", ")))" }.joined(separator: "; ")).
    Labels: \(fixture.labels.joined(separator: ", ")). Places: \(fixture.places.joined(separator: ", ")).
    """

/// What each project, section, label, place, and time holds, from the history alone: frequent words and example titles.
let statInsights: String = {
    func profile(_ name: String, _ tasks: [Task]) -> String {
        var counts: [String: Int] = [:]
        for t in tasks { for w in tokens(t.title) { counts[w, default: 0] += 1 } }
        let words = counts.sorted { $0.value * 10 + Int((idf[$0.key] ?? 0) * 3) > $1.value * 10 + Int((idf[$1.key] ?? 0) * 3) }.prefix(8).map(\.key)
        let examples = tasks.suffix(3).map { "\"\($0.title)\"" }
        return "- \(name) (\(tasks.count) to-dos): words \(words.joined(separator: ", ")); e.g. \(examples.joined(separator: ", "))"
    }
    var lines: [String] = ["Projects:"]
    for p in fixture.projects { lines.append(profile(p.name, history.filter { $0.project == p.name })) }
    lines.append("Sections:")
    for p in fixture.projects { for s in p.sections { lines.append(profile("\(p.name) / \(s)", history.filter { $0.project == p.name && $0.section == s })) } }
    lines.append("Labels:")
    for l in fixture.labels { lines.append(profile(l, history.filter { $0.labels.contains(l) })) }
    lines.append("Places:")
    for p in fixture.places { lines.append(profile(p, history.filter { $0.place == p })) }
    lines.append("Times:")
    for t in times { lines.append(profile(t, history.filter { $0.time == t })) }
    return lines.joined(separator: "\n")
}()

/// One sentence per project, label, and place, written once by the model from that bucket's last 25 titles.
func modelInsights() async throws -> String {
    var lines: [String] = []
    func describe(_ kind: String, _ name: String, _ tasks: [Task]) async throws {
        guard !tasks.isEmpty else { return }
        let session = LanguageModelSession(model: model, instructions: "Describe in one short sentence what kind of to-dos a user files under a \(kind), from examples. Name typical verbs and objects.")
        let r = try await session.respond(to: "\(kind) \"\(name)\":\n" + tasks.suffix(25).map(\.title).joined(separator: "\n"),
                                          options: GenerationOptions(samplingMode: .greedy))
        let times = Dictionary(grouping: tasks.compactMap(\.time), by: { $0 }).filter { $0.value.count * 3 >= tasks.count }.keys.sorted()
        lines.append("- \(kind) \(name): \(r.content)\(times.isEmpty ? "" : " Usually at \(times.joined(separator: " or ")).")")
    }
    for p in fixture.projects {
        try await describe("project", p.name, history.filter { $0.project == p.name })
        for s in p.sections { try await describe("section", "\(p.name) / \(s)", history.filter { $0.project == p.name && $0.section == s }) }
    }
    for l in fixture.labels { try await describe("label", l, history.filter { $0.labels.contains(l) }) }
    for p in fixture.places { try await describe("place", p, history.filter { $0.place == p }) }
    return lines.joined(separator: "\n")
}

// MARK: Strategies

/// The baseline answers when the history holds a close match; the model only sees the to-dos it has never met.
@MainActor func hybrid(_ text: String, prewarm: Bool = false) async throws -> Meta {
    let near = neighbors(text)
    if let first = near.first, first.score >= 0.35 { return vote(near) }
    let recent = history.suffix(8).filter { r in !near.contains { $0.task.title == r.title && $0.task.day == r.day } }
    return try await ask(baseInstructions + "\n" + catalog + "\nEarlier to-dos like this one, and the latest ones:\n" + (near.map(\.task) + recent).map(line).joined(separator: "\n"), text, prewarm: prewarm)
}

typealias Strategy = (String) async throws -> Meta
var insightsCache: String?
let strategies: [String: Strategy] = [
    "nothing": { _ in Meta() },
    "knn": { vote(neighbors($0)) },
    "embed": { vote(semanticNeighbors($0)) },
    // Word matches when the history has them, embeddings for words it has never seen.
    "mixed": { text in
        let near = neighbors(text)
        return vote(near.isEmpty ? semanticNeighbors(text) : near)
    },
    "zero": { try await ask(baseInstructions + "\n" + catalog, $0) },
    "recent": { text in
        try await ask(baseInstructions + "\n" + catalog + "\nThe user's latest to-dos:\n" + history.suffix(40).map(line).joined(separator: "\n"), text)
    },
    "similar": { text in
        let near = neighbors(text, k: 12).map(\.task)
        let recent = history.suffix(8).filter { r in !near.contains { $0.title == r.title && $0.day == r.day } }
        return try await ask(baseInstructions + "\n" + catalog + "\nEarlier to-dos like this one, and the latest ones:\n" + (near + recent).map(line).joined(separator: "\n"), text)
    },
    "stats": { try await ask(baseInstructions + "\nWhat this user files where:\n" + statInsights, $0) },
    "insights": { text in
        if insightsCache == nil { insightsCache = try await modelInsights() }
        return try await ask(baseInstructions + "\n" + catalog + "\nWhat this user files where:\n" + insightsCache!, text)
    },
    "hybrid": { try await hybrid($0) },
    // The model's labels and places were wrong more often than right, so it only files the to-do in a project.
    "lean": { text in
        let m = try await hybrid(text)
        guard neighbors(text).first.map({ $0.score < 0.35 }) ?? true else { return m }
        return Meta(project: m.project, section: m.section)
    },
    "warm": { try await hybrid($0, prewarm: true) },
]

// MARK: Scoring

func percentile(_ xs: [Double], _ p: Double) -> Double {
    let s = xs.sorted()
    return s.isEmpty ? 0 : s[min(s.count - 1, Int(Double(s.count) * p))]
}

/// The first half of the title's words, as if the user paused typing midway.
func typing(_ title: String) -> String {
    let words = title.split(separator: " ")
    return words.prefix(max(1, (words.count + 1) / 2)).joined(separator: " ")
}

var args = Array(CommandLine.arguments.dropFirst(2))
let verbose = args.contains("-v")
args.removeAll { $0 == "-v" }
let prefix = args.contains("--typing")
args.removeAll { $0 == "--typing" }
guard !args.isEmpty, args.allSatisfy({ strategies[$0] != nil }) else {
    print("usage: eval <fixture.json> [-v] [--typing] <strategy>...   strategies: \(strategies.keys.sorted().joined(separator: ", "))")
    exit(1)
}
if verbose { print(statInsights.split(separator: "\n").count, "insight lines,", statInsights.count, "chars") }

print("\(prefix ? "typing (first half of words)" : "full title")  pills: precision = right/shown, recall = right/expected, per field right/expected of shown")
for setName in fixture.sets.keys.sorted() {
    let cases = fixture.sets[setName]!
    for name in args {
        var shown = 0, right = 0, expected = 0, errors = 0, times: [Double] = []
        var fieldRight: [String: Int] = [:], fieldExpected: [String: Int] = [:], fieldShown: [String: Int] = [:]
        for c in cases {
            let text = prefix ? typing(c.title) : c.title
            idle = 0
            let t0 = Date()
            let got: Meta
            do { got = try await strategies[name]!(text) } catch {
                errors += 1
                if verbose { print("  ✗ \(text): \(error)") }
                got = Meta()
            }
            times.append(Date().timeIntervalSince(t0) - idle)
            let want = c.meta.pills, have = got.pills
            shown += have.count
            right += have.intersection(want).count
            expected += want.count
            for p in have { fieldShown[String(p.split(separator: ":")[0]), default: 0] += 1 }
            for p in want {
                let field = String(p.split(separator: ":")[0])
                fieldExpected[field, default: 0] += 1
                if have.contains(p) { fieldRight[field, default: 0] += 1 }
            }
            if verbose && have != want {
                print("  \(text): +\(have.subtracting(want).sorted()) -\(want.subtracting(have).sorted())")
            }
        }
        let fields = ["project", "section", "label", "place", "time"].map {
            "\($0) \(fieldRight[$0] ?? 0)/\(fieldExpected[$0] ?? 0) of \(fieldShown[$0] ?? 0)"
        }.joined(separator: "  ")
        print(String(format: "%@ %@: precision %.0f%% recall %.0f%% (shown %d)  %@  errors %d  median %.0fms p90 %.0fms",
                     setName, name.padding(toLength: 8, withPad: " ", startingAt: 0),
                     100 * Double(right) / Double(max(shown, 1)), 100 * Double(right) / Double(max(expected, 1)), shown,
                     fields, errors, 1000 * percentile(times, 0.5), 1000 * percentile(times, 0.9)))
    }
}
