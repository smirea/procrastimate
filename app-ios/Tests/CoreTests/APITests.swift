import Core
import Foundation
import Testing

@Suite struct APITests {
    @Test func aOneCharacterHighlightDecodes() throws {
        let highlight = try JSONDecoder.validating().decode(Search.Highlight.self, from: Data(#"{"text":"a","ranges":[[0,1]]}"#.utf8))
        #expect(highlight.ranges == [0..<1])
    }

    @Test func anOptionalFieldRejectsNullLikeZod() {
        let json = #"{"id":"p","name":"Home","createdAt":1,"sourceKey":null}"#
        #expect(throws: DecodingError.self) { try JSONDecoder().decode(Project.self, from: Data(json.utf8)) }
    }
}
