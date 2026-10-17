import Core
import Foundation
import FoundationModels

/// Asks Apple's on-device model how a finished ramble splits into to-dos and their listed items. It is private and
/// works offline. `Ramble.structured` reads every field with the grammar and keeps the split only where the transcript
/// backs it up, so a wrong or missing answer leaves the grammar's tasks. The schema mirrors the one `Evals/RambleModel`
/// measures.
@MainActor
enum RambleModel {
    /// The speaker's own words are the content, so the guardrails for transforming user text apply. They also keep
    /// ordinary tasks like `kill the weeds` from being refused.
    private static let model = SystemLanguageModel(guardrails: .permissiveContentTransformations)

    static var available: Bool { model.isAvailable }

    /// Loads the model while the speaker talks, so the split after stop skips the cold start.
    static func prewarm() {
        guard available else { return }
        let session = LanguageModelSession(model: model, instructions: Ramble.splitInstructions)
        session.prewarm()
        warm = session
    }

    /// The split, or nil when the model is unavailable, fails, or takes longer than `limit`.
    static func split(_ transcript: String, limit: Duration = .seconds(4)) async -> [RambleSplit]? {
        guard available else { return nil }
        let session = warm ?? LanguageModelSession(model: model, instructions: Ramble.splitInstructions)
        warm = nil
        let work = Task { @MainActor () -> [RambleSplit]? in
            do {
                let response = try await session.respond(
                    to: "Ramble: \(transcript)",
                    generating: Split.self,
                    options: GenerationOptions(samplingMode: .greedy)
                )
                return response.content.tasks.map { RambleSplit(text: $0.text, subtasks: $0.subtasks) }
            } catch {
                ErrorReport.log("Ramble model split failed", error: error)
                return nil
            }
        }
        let timeout = Task {
            try await Task.sleep(for: limit)
            work.cancel()
        }
        defer { timeout.cancel() }
        return await work.value
    }

    private static var warm: LanguageModelSession?

    @Generable
    struct SplitTask {
        @Guide(description: "The to-do in the speaker's own words, copied from the ramble, including when it is due and any reminder, without the listed items.")
        var text: String
        @Guide(description: "Items or steps the speaker listed for this to-do, one each, copied from the ramble. Empty when none were listed.")
        var subtasks: [String]
    }

    @Generable
    struct Split {
        var tasks: [SplitTask]
    }
}
