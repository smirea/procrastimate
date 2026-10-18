import Core
import Foundation
import Testing

@MainActor @Suite struct QuickAddButtonsTests {
    @Test func setQuickAddButtonsPatchesOnlyTheButtons() {
        let (store, written) = recordingStore(rows: settingsRows())
        store.setQuickAddButtons([.date, .labels])
        #expect(store.quickAddButtons == [.date, .labels])
        #expect(written.writes == [patch(.settings, "settings", ["quickAddButtons": .array([.string("date"), .string("labels")])])])
    }

    @Test func aReloadAdoptsTheOtherDevicesButtons() {
        let (store, _) = recordingStore()
        var rows = StoredRows()
        rows.settings = [Owned(owner: "me", value: API.Settings(quickAddButtons: [.repeat, .event]))]
        store.reload(Spaces(rows, me: "me"))
        #expect(store.quickAddButtons == [.repeat, .event])
        #expect(store.dictation == .native)
    }

    @Test func aUserWithoutSettingsRowsGetsTheDefaultButtons() {
        let (store, _) = recordingStore()
        #expect(store.quickAddButtons == [.date, .priority, .reminders, .subtasks])
    }

    @Test func anotherSpacesSettingsNeverApply() {
        var rows = StoredRows()
        rows.settings = [Owned(owner: "ann", value: API.Settings(quickAddButtons: [.labels]))]
        let (store, _) = recordingStore(rows: rows)
        #expect(store.quickAddButtons == [.date, .priority, .reminders, .subtasks])
    }
}
