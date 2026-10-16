import Core
import Testing

@Suite struct PlaceRadiusTests {
    @Test func spotsKeepASmallCircle() {
        #expect(Triggers.placeRadius(latitudeDelta: 0.0117, longitudeDelta: 0.0146, latitude: 40.42) == 150)
        #expect(Triggers.placeRadius(latitudeDelta: 0.009, longitudeDelta: 0.0148, latitude: 52.52) == 150)
        #expect(Triggers.placeRadius(latitudeDelta: 0, longitudeDelta: 0, latitude: 0) == 150)
    }

    @Test func areasFitInsideTheirShorterSide() {
        #expect(Triggers.placeRadius(latitudeDelta: 0.061, longitudeDelta: 0.0205, latitude: 37.77) == 900)
        #expect(Triggers.placeRadius(latitudeDelta: 0.0266, longitudeDelta: 0.0845, latitude: 52.5) == 1_480)
        #expect(Triggers.placeRadius(latitudeDelta: 0.3939, longitudeDelta: 0.7968, latitude: 52.52) == 21_920)
    }

    @Test func regionsCapAtAHundredKilometers() {
        #expect(Triggers.placeRadius(latitudeDelta: 3.29, longitudeDelta: 4.8, latitude: 48.9) == 100_000)
    }
}
