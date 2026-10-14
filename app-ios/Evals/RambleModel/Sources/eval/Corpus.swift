import Core
import Foundation
import FoundationModels

func corpusRegressions() async throws {
    let data = try Data(contentsOf: URL(fileURLWithPath: #filePath).appending(path: "../../../../../shared/vectors/ramble.json").standardized)
    let root = try JSONSerialization.jsonObject(with: data) as! [String: Any]
    let cases = (root["cases"] as! [[String: Any]]).filter { ($0["fn"] as? String) == "parseRamble" }
    var changed = 0, failed = 0
    for c in cases {
        let input = c["input"] as! [Any]
        let text = input[0] as! String
        let draft = grammar(text)
        guard !draft.tasks.isEmpty else { continue }
        do {
            let after = try await review(text, draft.tasks)
            let before = outs(draft.tasks)
            if after.map(\.description) != before.map(\.description) {
                changed += 1
                print("CHANGED \(text)\n   grammar \(before)\n   review  \(after)")
            }
        } catch { failed += 1 }
    }
    print("corpus: \(cases.count) cases, changed \(changed), model errors \(failed)")
}
