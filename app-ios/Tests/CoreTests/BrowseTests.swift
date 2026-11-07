import Core
import Foundation
import Testing

@Suite struct BrowseTests {
    let utc = TimeZone(identifier: "UTC")!

    @Test func labelsSortByNameIgnoringCaseAndAccents() {
        let labels = ["waiting", "Émails", "calls", "Calls"].enumerated().map {
            Label(id: "l-\($0.offset)", name: $0.element, createdAt: 0)
        }
        #expect(Browse.labelsByName(labels).map(\.name) == ["calls", "Calls", "Émails", "waiting"])
    }

    @Test func completedLineNamesTheDay() {
        let at = Date(timeIntervalSince1970: 1_791_972_000).epochMilliseconds
        #expect(Browse.completedLine(at, today: "2026-10-14", in: utc) == "Completed Today")
        #expect(Browse.completedLine(at, today: "2026-10-15", in: utc) == "Completed Yesterday")
    }
}
