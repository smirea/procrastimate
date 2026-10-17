import Core
import Testing

@Suite struct LabelColorsTests {
    /// Each `color: name, name.` line of the model's instructions, so a label named after one of them starts with the
    /// color the model will pick and doesn't switch a second after it is created.
    var promptNames: [(LabelColor, String)] {
        LabelColors.modelInstructions.split(separator: "\n").flatMap { line -> [(LabelColor, String)] in
            let parts = line.split(separator: ":", maxSplits: 1)
            guard parts.count == 2, let color = LabelColor(rawValue: String(parts[0])) else { return [] }
            let names = parts[1].trimmingCharacters(in: .whitespaces.union(["."])).components(separatedBy: ", ")
            return names.map { (color, $0) }
        }
    }

    @Test func thePromptListsEveryColor() {
        #expect(Set(promptNames.map(\.0)) == Set(LabelColor.allCases))
    }

    @Test func everyNameInThePromptThatAHintKnowsTakesThePromptsColor() {
        let disagreeing = promptNames.filter { color, name in LabelColors.hintedColor(name).map { $0 != color } ?? false }
        #expect(disagreeing.map { "\($1) is \($0.rawValue) in the prompt" } == [])
        #expect(promptNames.contains { LabelColors.hintedColor($1) != nil })
    }

    @Test func deepAndCreativeWorkTakeTheirOwnColorsOverWork() {
        #expect(LabelColors.defaultLabelColor("Deep work") == .indigo)
        #expect(LabelColors.defaultLabelColor("creative work") == .violet)
        #expect(LabelColors.defaultLabelColor("work") == .blue)
    }
}
