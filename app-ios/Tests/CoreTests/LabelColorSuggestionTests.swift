import Core
import Foundation
import Testing

@MainActor @Suite struct LabelColorSuggestionTests {
    let clock = AppClock.fixed(pinned, timeZone: TimeZone(identifier: "UTC")!)

    func color(_ store: Store, _ name: String) -> LabelColor? {
        store.labels.first { $0.name == name }?.color
    }

    @Test func aNewLabelKeepsTheDefaultWhenTheModelHasNoAnswer() async {
        let store = recordingStore(clock: clock).0
        let label = store.addLabel("tom")
        store.labelColorSuggester = { _ in nil }
        await store.suggestColor(for: label)
        #expect(color(store, "tom") == .teal)
    }

    @Test func aNewLabelTakesTheSuggestedColorAndSyncsIt() async {
        let (store, written) = recordingStore(clock: clock)
        let label = store.addLabel("tom")
        store.labelColorSuggester = { _ in .pink }
        await store.suggestColor(for: label)
        #expect(color(store, "tom") == .pink)
        #expect(written.writes.last == patch(.label, label.id, ["color": .string("pink")]))
    }

    @Test func aColorPickedWhileTheModelThinksWins() async {
        let store = recordingStore(clock: clock).0
        let label = store.addLabel("tom")
        store.labelColorSuggester = { _ in
            store.setLabelColor(label.id, .orange)
            return .pink
        }
        await store.suggestColor(for: label)
        #expect(color(store, "tom") == .orange)
    }

    @Test func aColorPickedAndPutBackWhileTheModelThinksWins() async {
        let store = recordingStore(clock: clock).0
        let label = store.addLabel("tom")
        store.labelColorSuggester = { _ in
            store.setLabelColor(label.id, .orange)
            store.setLabelColor(label.id, .teal)
            return .pink
        }
        await store.suggestColor(for: label)
        #expect(color(store, "tom") == .teal)
    }

    @Test func aRenameWhileTheModelThinksKeepsTheColor() async {
        let store = recordingStore(clock: clock).0
        let label = store.addLabel("tom")
        store.labelColorSuggester = { _ in
            store.renameLabel(label.id, "bills")
            return .pink
        }
        await store.suggestColor(for: label)
        #expect(color(store, "bills") == .teal)
    }

    @Test func aLabelDeletedWhileTheModelThinksStaysDeleted() async {
        let store = recordingStore(clock: clock).0
        let label = store.addLabel("tom")
        store.labelColorSuggester = { _ in
            store.deleteLabel(label.id)
            return .pink
        }
        await store.suggestColor(for: label)
        #expect(store.labels.isEmpty)
    }
}
