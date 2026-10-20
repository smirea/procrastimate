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

    @Test func searchSectionsKeepGroupOrderLimitsAndTotals() {
        let tasks = (0..<40).map { TaskItem(id: "t\($0)", title: "Home task \($0)", createdAt: $0) }
            + [TaskItem(id: "done", title: "Home done", createdAt: 0, completedAt: 5)]
        let projects = [Project(id: "p", name: "Home", createdAt: 0)]
        let results = Search.search("home", tasks, projects: projects, labels: [])
        let sections = SearchSections.sections(results)
        #expect(sections.map(\.title) == ["Projects", "Tasks", "Completed"])
        #expect(sections[1].total == 40)
        #expect(sections[1].rows.count == 30)
        #expect(sections[2].rows.map(\.id) == ["t-done"])
        #expect(SearchSections.sections(Search.search("zzz", tasks, projects: projects, labels: [])).isEmpty)
    }
}
