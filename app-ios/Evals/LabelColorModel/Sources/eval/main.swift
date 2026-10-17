import Core
import Foundation
import FoundationModels

struct Case: Decodable { let name: String; let colors: [LabelColor] }

let model = SystemLanguageModel(guardrails: .permissiveContentTransformations)

// Mirrors LabelColorModel in the app, which cannot be imported here.
@Generable struct Pick {
    @Guide(description: "The palette color for the label.", .anyOf(LabelColor.allCases.map(\.rawValue)))
    var color: String
}

struct Unknown: Error { let color: String }

func pick(_ name: String) async throws -> LabelColor {
    let session = LanguageModelSession(model: model, instructions: LabelColors.modelInstructions)
    let r = try await session.respond(to: "Label: \(name)", generating: Pick.self, options: GenerationOptions(samplingMode: .greedy))
    guard let color = LabelColor(rawValue: r.content.color) else { throw Unknown(color: r.content.color) }
    return color
}

typealias Strategy = @Sendable (String) async throws -> LabelColor
let strategies: [String: Strategy] = [
    "default": { LabelColors.defaultLabelColor($0) },
    "model": pick,
]

func percentile(_ xs: [Double], _ p: Double) -> Double {
    let sorted = xs.sorted()
    return sorted.isEmpty ? 0 : sorted[min(sorted.count - 1, Int(Double(sorted.count) * p))]
}

@main struct Eval { static func main() async throws {
    var args = Array(CommandLine.arguments.dropFirst())
    let verbose = args.contains("-v")
    args.removeAll { $0 == "-v" }
    guard args.count >= 2 else {
        print("usage: eval [-v] <cases.json> <strategy>...   strategies: \(strategies.keys.sorted().joined(separator: ", "))")
        return
    }
    let names = Array(args.dropFirst())
    for name in names where strategies[name] == nil { fatalError("unknown strategy \(name)") }
    let cases = try JSONDecoder().decode([Case].self, from: Data(contentsOf: URL(fileURLWithPath: args[0])))
    for name in names {
        var passed = 0, errors = 0, times: [Double] = []
        for c in cases {
            let t0 = Date()
            do {
                let color = try await strategies[name]!(c.name)
                if c.colors.contains(color) { passed += 1 } else if verbose {
                    print("✗ \(c.name): want \(c.colors.map(\.rawValue).joined(separator: "|")), \(name) \(color.rawValue)")
                }
            } catch {
                errors += 1
                if verbose { print("✗ \(c.name): \(name) error \(error)") }
            }
            times.append(Date().timeIntervalSince(t0))
        }
        print(String(format: "%@: passed %d/%d  errors %d  median %.2fs p90 %.2fs",
                     name, passed, cases.count, errors, percentile(times, 0.5), percentile(times, 0.9)))
    }
} }
