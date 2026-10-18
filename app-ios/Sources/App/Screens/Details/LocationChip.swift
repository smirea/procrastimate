import Core
import MapKit
import SwiftUI

/// The place chip and its sheet: an Apple Maps search with the Arrive, Leave, or During menu beside the field.
struct LocationChip: View {
    @Environment(PlaceMonitor.self) private var places
    let location: TaskLocation?
    /// Bumped to open the picker from outside, as quick add's `+` menu does.
    var openTrigger = 0
    let onChange: (TaskLocation?) -> Void

    @State private var open = PlacesDemo.has("sheet:location")

    var body: some View {
        let unwatched = location.flatMap(places.unwatched)
        Button {
            open = true
        } label: {
            Chip(
                systemImage: location == nil ? "mappin" : unwatched == nil ? "mappin.and.ellipse" : "exclamationmark.triangle",
                text: location.map(Triggers.formatLocation) ?? "Location",
                tone: location == nil ? .muted : .ink,
                iconTone: location == nil ? nil : unwatched == nil ? .accent : .toneToday
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(location.map { "Location: \(Triggers.formatLocation($0))\(unwatched == nil ? "" : ", not watched")" } ?? "Add location")
        .onChange(of: openTrigger) { open = true }
        .sheet(isPresented: $open) {
            LocationSheet(location: location, onChange: onChange)
        }
    }
}

extension LocationTrigger {
    var name: String {
        switch self {
        case .arrive: "Arrive"
        case .leave: "Leave"
        case .during: "During"
        }
    }

    var systemImage: String {
        switch self {
        case .arrive: "arrow.down.to.line"
        case .leave: "arrow.up.right"
        case .during: "clock"
        }
    }
}

private struct LocationSheet: View {
    @Environment(PlaceMonitor.self) private var places
    @Environment(Store.self) private var store
    @Environment(\.clock) private var clock
    @Environment(\.dismiss) private var dismiss
    /// `PlaceChoices.RecentPick`s as JSON, kept on this device only, since only iOS picks places.
    @AppStorage("recentPlaces") private var recentPlaces = Data()
    @Environment(Toasts.self) private var toasts
    let location: TaskLocation?
    let onChange: (TaskLocation?) -> Void

    @State private var query: String
    @State private var trigger: LocationTrigger
    @State private var radius: Double
    /// Only ever grows while the sheet is open, so `Fitted` stays put after it is tapped instead of vanishing under the
    /// finger.
    @State private var presets: [Triggers.RadiusPreset]
    @State private var search = PlaceSearch()
    @State private var resolving: MKLocalSearchCompletion?
    @FocusState private var focused: Bool

    init(location: TaskLocation?, onChange: @escaping (TaskLocation?) -> Void) {
        self.location = location
        self.onChange = onChange
        _query = State(initialValue: PlacesDemo.takeQuery() ?? "")
        _trigger = State(initialValue: location?.trigger ?? .arrive)
        _radius = State(initialValue: location?.radius ?? 150)
        _presets = State(initialValue: location.map(Triggers.radiusPresets(for:)) ?? Triggers.radiusPresets)
    }

    var body: some View {
        NavigationStack {
            List {
                if let location, query.isEmpty {
                    Section {
                        CurrentPlace(location: location, radius: radius)
                        RadiusEditor(radius: $radius, presets: presets, max: Triggers.maxRadius(deviceMax: places.maxRadius)) { saveRadius() }
                        if let unwatched = places.unwatched(location) {
                            UnwatchedNote(reason: unwatched)
                        }
                        Button("Remove location", systemImage: "trash", role: .destructive) {
                            onChange(nil)
                            dismiss()
                        }
                        .foregroundStyle(.toneOverdue)
                    }
                }
                if query.isEmpty {
                    let sections = PlaceChoices.sections(store.tasks, store.labels, picks: picks)
                    choiceSection("Recent", sections.recent)
                    choiceSection("Saved", sections.saved)
                    choiceSection("Other places", sections.other)
                }
                Section {
                    ForEach(search.results, id: \.self) { result in
                        Button { pick(result) } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(result.title).foregroundStyle(.ink)
                                    if !result.subtitle.isEmpty {
                                        Text(result.subtitle).font(.footnote).foregroundStyle(.muted).lineLimit(1)
                                    }
                                }
                                Spacer(minLength: 8)
                                if resolving == result { ProgressView() }
                            }
                            .contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("place-\(result.title)")
                    }
                }
            }
            .scrollDismissesKeyboard(.interactively)
            .safeAreaInset(edge: .top) { searchBar }
            .navigationTitle("Location")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(role: .close) { dismiss() }
                }
            }
        }
        .onAppear {
            focused = location == nil
            if !query.isEmpty { search.update(query, near: places.nearby) }
        }
        .onChange(of: query) { search.update(query, near: places.nearby) }
        .onChange(of: trigger) {
            guard var location, location.trigger != trigger else { return }
            location.trigger = trigger
            onChange(location)
        }
        .sensoryFeedback(.selection, trigger: trigger)
    }

    private var searchBar: some View {
        HStack(spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: "magnifyingglass").foregroundStyle(.muted)
                TextField("Search Apple Maps", text: $query)
                    .focused($focused)
                    .submitLabel(.search)
                    .autocorrectionDisabled()
                    .onSubmit { if let first = search.results.first { pick(first) } }
                if !query.isEmpty {
                    Button("Clear", systemImage: "xmark.circle.fill") { query = "" }
                        .labelStyle(.iconOnly)
                        .foregroundStyle(.faint)
                }
            }
            .padding(.horizontal, 12)
            .frame(minHeight: 44)
            .glassEffect(.regular.interactive(), in: .capsule)

            Menu {
                Picker("When", selection: $trigger) {
                    ForEach(LocationTrigger.allCases) { trigger in
                        SwiftUI.Label(trigger.name, systemImage: trigger.systemImage).tag(trigger)
                    }
                }
                .pickerStyle(.inline)
            } label: {
                HStack(spacing: 4) {
                    Text(trigger.name)
                    Image(systemName: "chevron.up.chevron.down").imageScale(.small)
                }
                .font(.subheadline.weight(.medium))
                .padding(.horizontal, 14)
                .frame(minHeight: 44)
                .glassEffect(.regular.interactive(), in: .capsule)
            }
            .accessibilityLabel("Trigger \(trigger.name)")
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
    }

    private var picks: [PlaceChoices.RecentPick] {
        (try? JSONDecoder().decode([PlaceChoices.RecentPick].self, from: recentPlaces)) ?? []
    }

    @ViewBuilder
    private func choiceSection(_ title: String, _ choices: [PlaceChoices.Choice]) -> some View {
        if !choices.isEmpty {
            Section(title) {
                ForEach(choices) { choice in
                    let current = location.map(Triggers.placeKey) == choice.id
                    Button { choose(choice.location) } label: {
                        HStack(spacing: 12) {
                            Image(systemName: choice.savedID == nil ? "mappin.and.ellipse" : "bookmark.fill")
                                .foregroundStyle(choice.savedID.flatMap(store.label)?.color.tone ?? .muted)
                                .frame(width: 22)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(choice.location.name).foregroundStyle(.ink)
                                Text([choice.location.address, Triggers.formatRadius(choice.location.radius)].compactMap { $0 }.joined(separator: " · "))
                                    .font(.footnote)
                                    .foregroundStyle(.muted)
                                    .lineLimit(1)
                            }
                            Spacer(minLength: 8)
                            if current { Image(systemName: "checkmark").foregroundStyle(.accent) }
                        }
                        .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("place-choice-\(choice.location.name)")
                    .accessibilityAddTraits(current ? .isSelected : [])
                }
            }
        }
    }

    /// Sets a picked place with the sheet's trigger, and remembers it as used on this device.
    private func choose(_ picked: TaskLocation) {
        var picked = picked
        picked.trigger = trigger
        onChange(picked)
        let next = PlaceChoices.record(picked, at: clock.now.epochMilliseconds, in: picks)
        if let data = try? JSONEncoder().encode(next) { recentPlaces = data }
        places.requestPermission()
        dismiss()
    }

    private func saveRadius() {
        guard var location, location.radius != radius else { return }
        location.radius = radius
        onChange(location)
        let next = Triggers.radiusPresets(for: location)
        if next.count > presets.count { withAnimation(.snappy) { presets = next } }
    }

    private func pick(_ result: MKLocalSearchCompletion) {
        guard resolving == nil else { return }
        resolving = result
        Task {
            defer { resolving = nil }
            let response: MKLocalSearch.Response
            do {
                response = try await MKLocalSearch(request: MKLocalSearch.Request(completion: result)).start()
            } catch {
                ErrorReport.log("Could not look up a place", error: error)
                toasts.show("Couldn’t find that place")
                return
            }
            guard let item = response.mapItems.first else {
                toasts.show("Couldn’t find that place")
                return
            }
            let coordinate = item.location.coordinate
            // The bounding region encloses every returned item, so only a single result is this place's own extent.
            let extent = response.mapItems.count == 1 ? response.boundingRegion : nil
            let fitted = extent.map {
                Triggers.placeRadius(
                    latitudeDelta: $0.span.latitudeDelta,
                    longitudeDelta: $0.span.longitudeDelta,
                    latitude: $0.center.latitude,
                    deviceMax: places.maxRadius
                )
            } ?? 150
            choose(TaskLocation(
                name: item.name ?? result.title,
                address: result.subtitle.isEmpty ? item.address?.shortAddress : result.subtitle,
                latitude: coordinate.latitude,
                longitude: coordinate.longitude,
                radius: fitted,
                fittedRadius: fitted,
                trigger: trigger
            ))
        }
    }
}

struct CurrentPlace: View {
    let location: TaskLocation
    let radius: Double
    @State private var position: MapCameraPosition

    init(location: TaskLocation, radius: Double) {
        self.location = location
        self.radius = radius
        _position = State(initialValue: Self.framing(location, radius))
    }

    /// Frames the whole circle with a margin, and never closer than a few blocks so a small place keeps its streets.
    static func framing(_ location: TaskLocation, _ radius: Double) -> MapCameraPosition {
        let span = max(900, radius * 2.6)
        let center = CLLocationCoordinate2D(latitude: location.latitude, longitude: location.longitude)
        return .region(MKCoordinateRegion(center: center, latitudinalMeters: span, longitudinalMeters: span))
    }

    var body: some View {
        let center = CLLocationCoordinate2D(latitude: location.latitude, longitude: location.longitude)
        VStack(alignment: .leading, spacing: 10) {
            Map(position: $position) {
                Marker(location.name, coordinate: center).tint(.accent)
                MapCircle(center: center, radius: radius)
                    .foregroundStyle(.accent.opacity(0.15))
                    .stroke(.accent, lineWidth: 1)
            }
            .frame(height: 160)
            .clipShape(.rect(cornerRadius: 12))
            .allowsHitTesting(false)
            .onChange(of: radius) { withAnimation(.snappy) { position = Self.framing(location, radius) } }
            VStack(alignment: .leading, spacing: 2) {
                Text(location.name).font(.headline).foregroundStyle(.ink)
                if let address = location.address {
                    Text(address).font(.footnote).foregroundStyle(.muted)
                }
            }
        }
        .padding(.vertical, 4)
    }
}

/// Presets for the common sizes and a log-scale slider between them. The circle follows while dragging, and the radius
/// is saved when the drag ends, so a drag syncs once.
struct RadiusEditor: View {
    @Binding var radius: Double
    let presets: [Triggers.RadiusPreset]
    let max: Double
    let onCommit: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                ForEach(presets, id: \.self) { preset in
                    let selected = radius == preset.meters
                    Button {
                        radius = preset.meters
                        onCommit()
                    } label: {
                        Text(preset.name)
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(selected ? .accent : .ink)
                            .padding(.horizontal, 12)
                            .frame(minHeight: 32)
                            .background(selected ? Color.accent.opacity(0.15) : Color.ink.opacity(0.06), in: .capsule)
                            .frame(minHeight: 44)
                            .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .disabled(preset.meters > max)
                    .accessibilityAddTraits(selected ? .isSelected : [])
                }
            }
            HStack(spacing: 12) {
                Slider(
                    value: Binding(
                        get: { Triggers.sliderPosition(of: radius, max: max) },
                        set: { radius = Triggers.radius(atSlider: $0, max: max) }
                    ),
                    onEditingChanged: { editing in if !editing { onCommit() } }
                )
                .accessibilityLabel("Radius")
                .accessibilityValue(Triggers.formatRadius(radius))
                Text(Triggers.formatRadius(radius))
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(.muted)
                    .frame(minWidth: 56, alignment: .trailing)
            }
        }
        .padding(.vertical, 4)
    }
}

private struct UnwatchedNote: View {
    let reason: PlaceMonitor.Unwatched

    var body: some View {
        SwiftUI.Label {
            Text(text).font(.footnote).foregroundStyle(.muted)
        } icon: {
            Image(systemName: "exclamationmark.triangle").foregroundStyle(.toneToday)
        }
        .accessibilityIdentifier("place-unwatched")
    }

    private var text: String {
        switch reason {
        case .refused: "iOS isn't watching this place, so it won't fire. A smaller radius may help."
        case .overLimit: "Not watched yet: iOS watches \(PlaceMonitor.limit) places, and sooner ones come first."
        }
    }
}

/// Apple Maps suggestions as the query changes, biased to where Stefan is when location access allows.
@MainActor @Observable
private final class PlaceSearch: NSObject, MKLocalSearchCompleterDelegate {
    private(set) var results: [MKLocalSearchCompletion] = []
    @ObservationIgnored private let completer = MKLocalSearchCompleter()

    override init() {
        super.init()
        completer.delegate = self
        completer.resultTypes = [.pointOfInterest, .address]
    }

    func update(_ query: String, near: CLLocation?) {
        if let near {
            completer.region = MKCoordinateRegion(center: near.coordinate, latitudinalMeters: 50_000, longitudinalMeters: 50_000)
        }
        if query.trimmingCharacters(in: .whitespaces).isEmpty {
            completer.cancel()
            results = []
        } else {
            completer.queryFragment = query
        }
    }

    nonisolated func completerDidUpdateResults(_ completer: MKLocalSearchCompleter) {
        MainActor.assumeIsolated { results = self.completer.results }
    }

    nonisolated func completer(_ completer: MKLocalSearchCompleter, didFailWithError error: Error) {
        MainActor.assumeIsolated { results = [] }
    }
}
