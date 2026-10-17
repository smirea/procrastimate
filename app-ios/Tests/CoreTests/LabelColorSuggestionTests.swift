import Core
import Foundation
import Testing

@MainActor @Suite struct LabelColorSuggestionTests {
    let clock = AppClock.fixed(pinned, timeZone: TimeZone(identifier: "UTC")!)

    func color(_ store: Store, _ name: String) -> LabelColor? {
        store.labels.first { $0.name == name }?.color
    }

    @Test func aNewLabelKeepsTheDefaultWhenTheModelHasNoAnswer() async {
        let store = Store(file: nil, clock: clock)
        let label = store.addLabel("tom")
        store.labelColorSuggester = { _ in nil }
        await store.suggestColor(for: label)
        #expect(color(store, "tom") == .teal)
    }

    @Test func aNewLabelTakesTheSuggestedColorAndSyncsIt() async {
        let store = Store(file: nil, clock: clock)
        let label = store.addLabel("tom")
        store.labelColorSuggester = { _ in .pink }
        await store.suggestColor(for: label)
        #expect(color(store, "tom") == .pink)
        let fields = store.snapshot.sync?.outbox.last { $0.kind == .label && $0.id == label.id }?.fields
        #expect(fields?["color"] == .string("pink"))
    }

    @Test func aColorPickedWhileTheModelThinksWins() async {
        let store = Store(file: nil, clock: clock)
        let label = store.addLabel("tom")
        store.labelColorSuggester = { _ in
            store.setLabelColor(label.id, .orange)
            return .pink
        }
        await store.suggestColor(for: label)
        #expect(color(store, "tom") == .orange)
    }

    @Test func aRenameWhileTheModelThinksKeepsTheColor() async {
        let store = Store(file: nil, clock: clock)
        let label = store.addLabel("tom")
        store.labelColorSuggester = { _ in
            store.renameLabel(label.id, "bills")
            return .pink
        }
        await store.suggestColor(for: label)
        #expect(color(store, "bills") == .teal)
    }

    @Test func aLabelDeletedWhileTheModelThinksStaysDeleted() async {
        let store = Store(file: nil, clock: clock)
        let label = store.addLabel("tom")
        store.labelColorSuggester = { _ in
            store.deleteLabel(label.id)
            return .pink
        }
        await store.suggestColor(for: label)
        #expect(store.labels.isEmpty)
    }
}
