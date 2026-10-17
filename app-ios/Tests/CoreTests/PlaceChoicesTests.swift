import Core
import Testing

@Suite struct PlaceChoicesTests {
    private func spot(_ name: String, _ latitude: Double, radius: Double = 150) -> TaskLocation {
        TaskLocation(name: name, address: nil, latitude: latitude, longitude: 13.4, radius: radius, trigger: .leave)
    }

    private func at(_ name: String, _ latitude: Double, createdAt: Int) -> TaskItem {
        TaskItem(id: name, title: name, location: spot(name, latitude), createdAt: createdAt)
    }

    private let home = Label(
        id: "home",
        name: "Home",
        color: .green,
        place: SavedPlace(address: "Parkweg 1", latitude: 52.1, longitude: 13.4, radius: 500),
        createdAt: 0
    )
    private let gym = Label(
        id: "gym",
        name: "Gym",
        color: .blue,
        place: SavedPlace(address: nil, latitude: 52.9, longitude: 13.4, radius: 300),
        createdAt: 0
    )

    @Test func recentPlacesComeFirstThenEverySavedOneThenTheRestByUse() {
        let tasks = [
            at("Rewe", 52.2, createdAt: 10),
            at("Old home name", 52.1, createdAt: 40),
            at("Park", 52.3, createdAt: 30),
            at("Cafe", 52.4, createdAt: 20),
            at("Library", 52.5, createdAt: 5),
        ]
        let sections = PlaceChoices.sections(tasks, [gym, home], picks: [])
        #expect(sections.recent.map(\.location.name) == ["Home", "Park", "Cafe"])
        #expect(sections.recent.first?.savedID == "home")
        #expect(sections.recent.first?.location.radius == 500)
        #expect(sections.saved.map(\.location.name) == ["Gym"])
        #expect(sections.other.map(\.location.name) == ["Rewe", "Library"])
    }

    @Test func aPickOnThisDeviceCountsAsUseEvenOnAnOldTask() {
        let tasks = [at("Rewe", 52.2, createdAt: 10), at("Park", 52.3, createdAt: 30)]
        let picks = PlaceChoices.record(spot("Rewe again", 52.2), at: 50, in: [])
        let sections = PlaceChoices.sections(tasks, [], picks: picks)
        #expect(sections.recent.map(\.location.name) == ["Rewe again", "Park"])
        #expect(sections.other.isEmpty)
    }

    @Test func picksKeepOnePerPlaceNewestFirst() {
        var picks = PlaceChoices.record(spot("A", 1), at: 1, in: [])
        picks = PlaceChoices.record(spot("B", 2), at: 2, in: picks)
        picks = PlaceChoices.record(spot("A again", 1), at: 3, in: picks)
        #expect(picks.map(\.location.name) == ["A again", "B"])
        let many = (0..<30).reduce([PlaceChoices.RecentPick]()) { PlaceChoices.record(spot("\($1)", Double($1)), at: $1, in: $0) }
        #expect(many.count == PlaceChoices.recentLimit + PlaceChoices.otherLimit)
    }

    @Test func otherPlacesStopAtTwenty() {
        let tasks = (0..<30).map { at("P\($0)", Double($0), createdAt: $0) }
        let sections = PlaceChoices.sections(tasks, [], picks: [])
        #expect(sections.recent.count == 3)
        #expect(sections.other.count == 20)
        #expect(sections.other.first?.location.name == "P26")
    }
}
