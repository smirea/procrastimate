import Core
import Foundation
import FoundationModels

let projects = ["Home", "Work", "Side Project", "Finance"].enumerated().map { Project(id: "p\($0.offset)", name: $0.element, createdAt: 0) }
let labels = ["calls", "errands", "waiting", "deep work"].enumerated().map { Label(id: "l\($0.offset)", name: $0.element, createdAt: 0) }
let zone = TimeZone(identifier: "UTC")!
// Wednesday 2026-10-14 14:00 UTC. The labelled cases resolve relative dates against it.
let now = Date(timeIntervalSince1970: 1791986400)

struct Expected: Decodable {
    let title: String
    var subtasks: [String] = []
    // Absent keys are not scored, so structure-only cases still count.
    var date: String??
    var time: String??
    var remindBefore: [Int]?
    enum CodingKeys: CodingKey { case title, subtasks, date, time, remindBefore }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        title = try c.decode(String.self, forKey: .title)
        subtasks = try c.decodeIfPresent([String].self, forKey: .subtasks) ?? []
        if c.contains(.date) { date = .some(try c.decodeIfPresent(String.self, forKey: .date)) }
        if c.contains(.time) { time = .some(try c.decodeIfPresent(String.self, forKey: .time)) }
        remindBefore = try c.decodeIfPresent([Int].self, forKey: .remindBefore)
    }
}
struct Case: Decodable { let text: String; let tasks: [Expected] }

struct Out: CustomStringConvertible {
    var title: String
    var subtasks: [String] = []
    var date: String?
    var time: String?
    var remindBefore: [Int] = []
    // Compared only in corpus mode, where any change from the grammar is a regression to inspect.
    var rest = ""
    init(_ t: RambleTask) {
        rest = [t.priority.map { "p\($0.rawValue)" }, t.recurrence.map { "\($0)" }, t.projectId, t.labelIds.isEmpty ? nil : "\(t.labelIds)",
                t.notes.isEmpty ? nil : "note: \(t.notes)", t.reminders.isEmpty ? nil : "\(t.reminders)"]
            .compactMap { $0 }.joined(separator: " ")
        title = t.title
        subtasks = t.subtasks.map(\.title)
        date = t.due?.date
        time = t.due?.time
        remindBefore = t.reminders.compactMap { if case .before(let m) = $0 { m } else { nil } }
    }
    var full: String { "\(description) \(rest) \(subtasks.count)" }
    var description: String {
        var s = title
        if let date { s += " @\(date)\(time.map { " \($0)" } ?? "")" }
        if !remindBefore.isEmpty { s += " ⏰\(remindBefore)" }
        if !subtasks.isEmpty { s += " [\(subtasks.joined(separator: " | "))]" }
        return s
    }
}

let articles: Set<String> = ["a", "an", "the", "some"]
func words(_ s: String) -> [String] {
    s.lowercased().split(whereSeparator: { !$0.isLetter && !$0.isNumber && $0 != "'" }).map(String.init).filter { !articles.contains($0) }
}
func same(_ a: String, _ b: String) -> Bool {
    let x = Set(words(a)), y = Set(words(b))
    if x.isEmpty || y.isEmpty { return x == y }
    return Double(x.intersection(y).count) / Double(x.union(y).count) >= 0.75
}
func structureMatches(_ out: [Out], _ exp: [Expected]) -> Bool {
    out.count == exp.count && zip(out, exp).allSatisfy { o, e in
        same(o.title, e.title) && o.subtasks.count == e.subtasks.count && zip(o.subtasks, e.subtasks).allSatisfy { same($0, $1) }
    }
}
func fieldsMatch(_ out: [Out], _ exp: [Expected]) -> Bool {
    out.count == exp.count && zip(out, exp).allSatisfy { o, e in
        (e.date.map { $0 == o.date } ?? true) && (e.time.map { $0 == o.time } ?? true)
            && (e.remindBefore.map { $0.sorted() == o.remindBefore.sorted() } ?? true)
    }
}

func grammar(_ text: String) -> [RambleTask] { Ramble.parse(text, now: now, projects: projects, labels: labels, in: zone).tasks }

let model = SystemLanguageModel(guardrails: .permissiveContentTransformations)

// Mirrors RambleModel in the app, which cannot be imported here.
@Generable struct SplitTask {
    @Guide(description: "The to-do in the speaker's own words, copied from the ramble, including when it is due and any reminder, without the listed items.")
    var text: String
    @Guide(description: "Items or steps the speaker listed for this to-do, one each, copied from the ramble. Empty when none were listed.")
    var subtasks: [String]
}
@Generable struct Split { var tasks: [SplitTask] }

struct Unbacked: Error {}

func split(_ text: String) async throws -> [RambleTask] {
    let draft = Ramble.parse(text, now: now, projects: projects, labels: labels, in: zone)
    if Ramble.usesCommands(draft) { return draft.tasks }
    let session = LanguageModelSession(model: model, instructions: Ramble.splitInstructions)
    let r = try await session.respond(to: "Ramble: \(text)", generating: Split.self, options: GenerationOptions(samplingMode: .greedy))
    let pieces = r.content.tasks.map { RambleSplit(text: $0.text, subtasks: $0.subtasks) }
    guard let tasks = Ramble.structured(pieces, transcript: text, draft: draft, now: now, projects: projects, labels: labels, in: zone) else {
        if ProcessInfo.processInfo.environment["WHY"] != nil { print("  fallback: \(pieces)") }
        throw Unbacked()
    }
    return tasks
}

typealias Strategy = @Sendable (String) async throws -> [RambleTask]
let strategies: [String: Strategy] = [
    "grammar": { grammar($0) },
    "split": split,
]

struct Score { var structure = 0, fields = 0, both = 0, errors = 0, times: [Double] = [] }

func run(_ name: String, _ strategy: Strategy, _ cases: [Case], verbose: Bool) async -> Score {
    var s = Score()
    for c in cases {
        let t0 = Date()
        let out: [Out]
        do { out = try await strategy(c.text).map(Out.init) } catch {
            s.errors += 1
            out = grammar(c.text).map(Out.init)
        }
        s.times.append(Date().timeIntervalSince(t0))
        let st = structureMatches(out, c.tasks), fi = fieldsMatch(out, c.tasks)
        s.structure += st ? 1 : 0; s.fields += fi ? 1 : 0; s.both += st && fi ? 1 : 0
        if verbose && !(st && fi) {
            let want = c.tasks.map { e in
                var w = e.title
                if let d = e.date ?? nil { w += " @\(d)\((e.time ?? nil).map { " \($0)" } ?? "")" }
                if let r = e.remindBefore, !r.isEmpty { w += " ⏰\(r)" }
                if !e.subtasks.isEmpty { w += " [\(e.subtasks.joined(separator: " | "))]" }
                return w
            }
            print("\n> \(c.text)\n  want \(want)\n  \(name) \(st ? "S✓" : "S✗") \(fi ? "F✓" : "F✗") \(out)")
        }
    }
    return s
}

func percentile(_ xs: [Double], _ p: Double) -> Double {
    let sorted = xs.sorted()
    return sorted.isEmpty ? 0 : sorted[min(sorted.count - 1, Int(Double(sorted.count) * p))]
}

func corpusCases() throws -> [String] {
    let url = URL(fileURLWithPath: #filePath).appending(path: "../../../../../../shared/vectors/ramble.json").standardized
    let root = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
    return (root["cases"] as! [[String: Any]]).filter { ($0["fn"] as? String) == "parseRamble" }.map { ($0["input"] as! [Any])[0] as! String }
}

// The grammar passes every locked vector, so any difference from it on the corpus is a regression to inspect.
func corpus(_ name: String, _ strategy: Strategy, verbose: Bool) async throws {
    var changed = 0, errors = 0, total = 0
    for text in try corpusCases() {
        let before = grammar(text).map(Out.init).map(\.full)
        guard !before.isEmpty else { continue }
        total += 1
        do {
            let after = try await strategy(text).map(Out.init).map(\.full)
            if after != before {
                changed += 1
                if verbose { print("CHANGED \(text)\n   grammar \(before)\n   \(name) \(after)") }
            }
        } catch { errors += 1 }
    }
    print("corpus \(name): \(total) cases, changed \(changed), errors \(errors)")
}

@main struct Eval { static func main() async throws {
    var args = Array(CommandLine.arguments.dropFirst())
    let verbose = args.contains("-v")
    args.removeAll { $0 == "-v" }
    guard args.count >= 2 else {
        print("usage: eval [-v] <cases.json|corpus> <strategy>...   strategies: \(strategies.keys.sorted().joined(separator: ", "))")
        return
    }
    let names = Array(args.dropFirst())
    for name in names where strategies[name] == nil { fatalError("unknown strategy \(name)") }
    if args[0] == "corpus" {
        for name in names { try await corpus(name, strategies[name]!, verbose: verbose) }
        return
    }
    let cases = try JSONDecoder().decode([Case].self, from: Data(contentsOf: URL(fileURLWithPath: args[0])))
    for name in names {
        let s = await run(name, strategies[name]!, cases, verbose: verbose)
        print(String(format: "%@ %@: structure %d/%d  fields %d/%d  both %d/%d  errors %d  median %.2fs p90 %.2fs",
                     args[0].split(separator: "/").last.map(String.init) ?? "", name, s.structure, cases.count, s.fields, cases.count,
                     s.both, cases.count, s.errors, percentile(s.times, 0.5), percentile(s.times, 0.9)))
    }
} }
