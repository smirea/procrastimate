import Core
import Foundation
import FoundationModels

/// Asks Apple's on-device model which palette color fits a new label's name. iOS only: the web keeps
/// `defaultLabelColor`. The label is created with that default first, so an unavailable, failing, or slow model leaves it.
@MainActor
enum LabelColorModel {
    /// A label name is the user's own words, like a ramble, so names such as `kill weeds` are not refused.
    private static let model = SystemLanguageModel(guardrails: .permissiveContentTransformations)

    /// The color, or nil when the model is unavailable, fails, or takes longer than `limit`.
    static func color(for name: String, limit: Duration = .seconds(5)) async -> LabelColor? {
        #if DEBUG
        // The simulator has no Apple Intelligence, so a UI test names the model's answer to drive the rest of the path.
        if let answer = ProcessInfo.processInfo.environment["PROCRASTIMATE_LABEL_COLOR"] {
            try? await Task.sleep(for: .seconds(1))
            return LabelColor(rawValue: answer)
        }
        #endif
        guard model.isAvailable else { return nil }
        let session = LanguageModelSession(model: model, instructions: LabelColors.modelInstructions)
        let work = Task { @MainActor () -> LabelColor? in
            do {
                let response = try await session.respond(
                    to: "Label: \(name)",
                    generating: Pick.self,
                    options: GenerationOptions(samplingMode: .greedy)
                )
                return LabelColor(rawValue: response.content.color)
            } catch is CancellationError {
                return nil
            } catch {
                ErrorReport.log("Label color model failed", error: error)
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

    @Generable
    struct Pick {
        @Guide(description: "The palette color for the label.", .anyOf(LabelColor.allCases.map(\.rawValue)))
        var color: String
    }
}
