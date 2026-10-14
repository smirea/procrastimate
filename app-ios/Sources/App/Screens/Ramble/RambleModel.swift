import Core
import Foundation
import FoundationModels

/// Asks Apple's on-device model to review the grammar's draft once a ramble ends. It is private and works offline.
/// `Ramble.reviewed` keeps only the verdicts the transcript backs up, so a wrong or missing answer leaves the grammar's
/// tasks. The schema mirrors the one `Evals/RambleModel` measures.
@MainActor
enum RambleModel {
    /// The speaker's own words are the content, so the guardrails for transforming user text apply. They also keep
    /// ordinary tasks like `kill the weeds` from being refused.
    private static let model = SystemLanguageModel(guardrails: .permissiveContentTransformations)

    static var available: Bool { model.isAvailable }

    /// Loads the model while the speaker talks, so the review after stop skips the cold start.
    static func prewarm() {
        guard available else { return }
        let session = LanguageModelSession(model: model, instructions: RambleReview.instructions)
        session.prewarm()
        warm = session
    }

    /// The verdicts, or nil when the model is unavailable, fails, or takes longer than `limit`.
    static func review(_ transcript: String, _ tasks: [RambleTask], limit: Duration = .seconds(4)) async -> [RambleReview]? {
        guard available, !tasks.isEmpty else { return nil }
        let session = warm ?? LanguageModelSession(model: model, instructions: RambleReview.instructions)
        warm = nil
        let lines = tasks.enumerated().map { "\($0.offset + 1). \($0.element.title)" }.joined(separator: "\n")
        let prompt = "Ramble: \(transcript)\nDraft:\n\(lines)"
        let work = Task { @MainActor () -> [RambleReview]? in
            do {
                let response = try await session.respond(
                    to: prompt,
                    generating: Review.self,
                    options: GenerationOptions(sampling: .greedy)
                )
                return response.content.tasks.map {
                    RambleReview(number: $0.number, role: $0.role.reviewRole, items: $0.items)
                }
            } catch {
                ErrorReport.log("Ramble model review failed", detail: String(reflecting: error))
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
    enum Role: String {
        case task, subtaskOfPrevious, partOfPrevious, takenBack

        var reviewRole: RambleReview.Role { RambleReview.Role(rawValue: rawValue) ?? .task }
    }

    @Generable
    struct Reviewed {
        @Guide(description: "The draft task's number.")
        var number: Int
        var role: Role
        @Guide(description: "If the task's text names several items or steps that belong inside it, those items copied exactly from the text. Otherwise empty.")
        var items: [String]
    }

    @Generable
    struct Review {
        @Guide(description: "One entry per draft task, in order.")
        var tasks: [Reviewed]
    }
}
