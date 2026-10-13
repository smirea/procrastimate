import Core
import MapKit
import SwiftUI

/// The place chip and its sheet: an Apple Maps search with the Arrive, Leave, or During menu beside the field.
struct LocationChip: View {
    let location: TaskLocation?
    let onChange: (TaskLocation?) -> Void

    @State private var open = PlacesDemo.has("sheet:location")

    var body: some View {
        Button {
            open = true
        } label: {
            Chip(
                systemImage: location == nil ? "mappin" : "mappin.and.ellipse",
                text: location.map(Triggers.formatLocation) ?? "Location",
                tone: location == nil ? .muted : .ink,
                iconTone: location == nil ? nil : .accent
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(location.map { "Location: \(Triggers.formatLocation($0))" } ?? "Add location")
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
    @Environment(\.dismiss) private var dismiss
    let location: TaskLocation?
    let onChange: (TaskLocation?) -> Void

    @State private var query = PlacesDemo.value("query") ?? ""
    @State private var trigger: LocationTrigger
    @State private var search = PlaceSearch()
    @State private var resolving: MKLocalSearchCompletion?
    @FocusState private var focused: Bool

    init(location: TaskLocation?, onChange: @escaping (TaskLocation?) -> Void) {
        self.location = location
        self.onChange = onChange
        _trigger = State(initialValue: location?.trigger ?? .arrive)
    }

    var body: some View {
        NavigationStack {
            List {
                if let location, query.isEmpty {
                    Section {
                        CurrentPlace(location: location)
                        Button("Remove location", systemImage: "trash", role: .destructive) {
                            onChange(nil)
                            dismiss()
                        }
                        .foregroundStyle(.toneOverdue)
                    }
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

    private func pick(_ result: MKLocalSearchCompletion) {
        guard resolving == nil else { return }
        resolving = result
        Task {
            defer { resolving = nil }
            guard let item = try? await MKLocalSearch(request: MKLocalSearch.Request(completion: result)).start().mapItems.first
            else { return }
            let coordinate = item.location.coordinate
            onChange(TaskLocation(
                name: item.name ?? result.title,
                address: result.subtitle.isEmpty ? item.address?.shortAddress : result.subtitle,
                latitude: coordinate.latitude,
                longitude: coordinate.longitude,
                radius: 150,
                trigger: trigger
            ))
            places.requestPermission()
            dismiss()
        }
    }
}

private struct CurrentPlace: View {
    let location: TaskLocation

    var body: some View {
        let center = CLLocationCoordinate2D(latitude: location.latitude, longitude: location.longitude)
        VStack(alignment: .leading, spacing: 10) {
            Map(initialPosition: .region(MKCoordinateRegion(center: center, latitudinalMeters: 900, longitudinalMeters: 900))) {
                Marker(location.name, coordinate: center).tint(.accent)
                MapCircle(center: center, radius: location.radius)
                    .foregroundStyle(.accent.opacity(0.15))
                    .stroke(.accent, lineWidth: 1)
            }
            .frame(height: 160)
            .clipShape(.rect(cornerRadius: 12))
            .allowsHitTesting(false)
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
