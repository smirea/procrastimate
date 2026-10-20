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

    @Test func areasStayWithinWhatTheDeviceCanWatch() {
        #expect(Triggers.placeRadius(latitudeDelta: 0.3939, longitudeDelta: 0.7968, latitude: 52.52, deviceMax: 10_000) == 10_000)
        #expect(Triggers.placeRadius(latitudeDelta: 0.0266, longitudeDelta: 0.0845, latitude: 52.5, deviceMax: 10_000) == 1_480)
    }

    @Test func theSliderSpansABlockToAHundredKilometersOnALogScale() {
        #expect(Triggers.radius(atSlider: 0, max: 100_000) == 100)
        #expect(Triggers.radius(atSlider: 1, max: 100_000) == 100_000)
        #expect(Triggers.radius(atSlider: 1.0 / 3, max: 100_000) == 1_000)
        #expect(Triggers.radius(atSlider: 0.5, max: 100_000) == 3_200)
        #expect(Triggers.radius(atSlider: 0.8, max: 100_000) == 25_000)
        #expect(Triggers.radius(atSlider: 0.1, max: 100_000) == 200)
    }

    @Test func theSliderStopsAtWhatTheDeviceCanWatch() {
        #expect(Triggers.maxRadius(deviceMax: nil) == 100_000)
        #expect(Triggers.maxRadius(deviceMax: 10_000) == 10_000)
        #expect(Triggers.radius(atSlider: 1, max: 10_000) == 10_000)
    }

    @Test func aRadiusSitsWhereTheSliderWouldProduceIt() {
        #expect(Triggers.sliderPosition(of: 100, max: 100_000) == 0)
        #expect(Triggers.sliderPosition(of: 100_000, max: 100_000) == 1)
        #expect(Triggers.sliderPosition(of: 250_000, max: 100_000) == 1)
        #expect(Triggers.radius(atSlider: Triggers.sliderPosition(of: 1_480, max: 100_000), max: 100_000) == 1_500)
    }

    private func park(radius: Double, fitted: Double?) -> TaskLocation {
        TaskLocation(name: "Tiergarten", latitude: 52.51, longitude: 13.36, radius: radius, fittedRadius: fitted, trigger: .arrive)
    }

    @Test func aChangedRadiusOffersTheFittedSizeFirst() {
        #expect(Triggers.radiusPresets(for: park(radius: 150, fitted: 1_480)).map(\.name) == ["Fitted", "Block", "Neighborhood", "City"])
        #expect(Triggers.radiusPresets(for: park(radius: 150, fitted: 1_480)).first?.meters == 1_480)
    }

    @Test func theFittedSizeHidesWhileItIsTheRadiusOrAnotherPreset() {
        #expect(Triggers.radiusPresets(for: park(radius: 1_480, fitted: 1_480)).map(\.name) == ["Block", "Neighborhood", "City"])
        #expect(Triggers.radiusPresets(for: park(radius: 1_000, fitted: 150)).map(\.name) == ["Block", "Neighborhood", "City"])
        #expect(Triggers.radiusPresets(for: park(radius: 1_000, fitted: nil)).map(\.name) == ["Block", "Neighborhood", "City"])
    }
}
