import Core
import SwiftUI

/// Saves a place under a name with the radius it watches, or changes a saved place's radius. Either way the open tasks
/// at the place take the radius, and a saved one its name.
struct PlaceSheet: View {
    enum Mode {
        case save(TaskLocation)
        case edit(Core.Label)
    }

    @Environment(Store.self) private var store
    @Environment(PlaceMonitor.self) private var places
    @Environment(\.dismiss) private var dismiss
    let mode: Mode

    @State private var name: String
    @State private var radius: Double
    @State private var taken = false
    @FocusState private var nameFocused: Bool

    init(mode: Mode) {
        self.mode = mode
        let location = Self.location(mode)
        _name = State(initialValue: location.name)
        _radius = State(initialValue: location.radius)
    }

    private static func location(_ mode: Mode) -> TaskLocation {
        switch mode {
        case let .save(location): location
        case let .edit(label): Triggers.placeLocation(label, .arrive)!
        }
    }

    var body: some View {
        let location = Self.location(mode)
        NavigationStack {
            List {
                if case .save = mode {
                    Section {
                        TextField("Name, such as Home", text: $name)
                            .focused($nameFocused)
                            .submitLabel(.done)
                            .onSubmit(save)
                            .onChange(of: name) { taken = false }
                            .accessibilityIdentifier("place-name")
                    } footer: {
                        Text(taken ? "A label is already called that." : "Pick it as @name anywhere a label goes.")
                            .foregroundStyle(taken ? .toneOverdue : .muted)
                    }
                }
                Section {
                    CurrentPlace(location: location, radius: radius)
                    RadiusEditor(
                        radius: $radius,
                        presets: Triggers.radiusPresets(for: location),
                        max: Triggers.maxRadius(deviceMax: places.maxRadius)
                    ) {}
                }
            }
            .navigationTitle(isSaving ? "Save place" : "Edit place")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(role: .close) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save", action: save)
                        .disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        .accessibilityIdentifier("place-save")
                }
            }
        }
        .onAppear { nameFocused = isSaving }
    }

    private var isSaving: Bool {
        if case .save = mode { true } else { false }
    }

    private func save() {
        switch mode {
        case let .save(location):
            let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { return }
            let place = SavedPlace(
                address: location.address,
                latitude: location.latitude,
                longitude: location.longitude,
                radius: radius,
                fittedRadius: location.fittedRadius
            )
            guard withAnimation(.snappy, { store.savePlace(trimmed, place) }) != nil else {
                taken = true
                return
            }
        case let .edit(label):
            if radius != label.place?.radius { store.setPlaceRadius(label.id, radius) }
        }
        dismiss()
    }
}
