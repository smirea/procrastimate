import Core
import Foundation
import FoundationModels

let projects = ["Home", "Work", "Side Project", "Finance"].enumerated().map { Project(id: "p\($0.offset)", name: $0.element, createdAt: 0) }
let labels = ["calls", "errands", "waiting", "deep work"].enumerated().map { Label(id: "l\($0.offset)", name: $0.element, createdAt: 0) }
let zone = TimeZone(identifier: "UTC")!
let now = Date(timeIntervalSince1970: 1791986400)

struct Out: CustomStringConvertible { var title: String; var subtasks: [String]
    var description: String { subtasks.isEmpty ? title : "\(title) [\(subtasks.joined(separator: " | "))]" } }

func words(_ s: String) -> [String] {
    s.lowercased().split(whereSeparator: { !$0.isLetter && !$0.isNumber && $0 != "'" }).map(String.init)
}
func same(_ a: String, _ b: String) -> Bool {
    let x = Set(words(a)), y = Set(words(b))
    if x.isEmpty || y.isEmpty { return x == y }
    return Double(x.intersection(y).count) / Double(x.union(y).count) >= 0.75
}
func matches(_ out: [Out], _ exp: [Expected]) -> Bool {
    guard out.count == exp.count else { return false }
    return zip(out, exp).allSatisfy { o, e in
        same(o.title, e.title) && o.subtasks.count == e.subtasks.count && zip(o.subtasks, e.subtasks).allSatisfy { same($0, $1) }
    }
}

func grammar(_ text: String) -> RambleDraft { Ramble.parse(text, now: now, projects: projects, labels: labels, in: zone) }
func outs(_ d: [RambleTask]) -> [Out] { d.map { Out(title: $0.title, subtasks: $0.subtasks.map(\.title)) } }

// Mirrors RambleModel in the app, which cannot be imported here.
@Generable enum Role: String { case task, subtaskOfPrevious, partOfPrevious, takenBack }
@Generable struct Reviewed {
    @Guide(description: "The draft task's number.") var number: Int
    var role: Role
    @Guide(description: "If the task's text names several items or steps that belong inside it, those items copied exactly from the text. Otherwise empty.")
    var items: [String]
}
@Generable struct Review { @Guide(description: "One entry per draft task, in order.") var tasks: [Reviewed] }

func review(_ text: String, _ draft: [RambleTask]) async throws -> [Out] {
    let session = LanguageModelSession(model: SystemLanguageModel(guardrails: .permissiveContentTransformations), instructions: RambleReview.instructions)
    let lines = draft.enumerated().map { "\($0.offset + 1). \($0.element.title)" }.joined(separator: "\n")
    let r = try await session.respond(to: "Ramble: \(text)\nDraft:\n\(lines)", generating: Review.self, options: GenerationOptions(sampling: .greedy))
    let reviews = r.content.tasks.map { RambleReview(number: $0.number, role: RambleReview.Role(rawValue: $0.role.rawValue) ?? .task, items: $0.items) }
    return outs(Ramble.reviewed(draft, by: reviews, in: text))
}

@main struct Eval { static func main() async throws {
    if CommandLine.arguments.contains("corpus") { try await corpusRegressions(); return }
    var g = 0, b = 0, times: [Double] = []
    for c in cases {
        let d = grammar(c.text)
        let go = outs(d.tasks)
        let t0 = Date()
        let bo = (try? await review(c.text, d.tasks)) ?? go
        times.append(Date().timeIntervalSince(t0))
        let gm = matches(go, c.tasks), bm = matches(bo, c.tasks)
        g += gm ? 1 : 0; b += bm ? 1 : 0
        if !gm || !bm {
            print("\n> \(c.text)\n  want    \(c.tasks.map { Out(title: $0.title, subtasks: $0.subtasks) })")
            print("  grammar \(gm ? "✓" : "✗") \(go)\n  review  \(bm ? "✓" : "✗") \(bo)")
        }
    }
    times.sort()
    print("\ngrammar \(g)/\(cases.count)  review \(b)/\(cases.count)  review median \(String(format: "%.2f", times[times.count / 2]))s p90 \(String(format: "%.2f", times[Int(Double(times.count) * 0.9)]))s")
} }
