import Observation

@MainActor @Observable
final class Navigator {
    var tab: AppTab = .inbox
    var paths: [AppTab: [Route]] = [:]
    var sheet: Sheet?
    /// Set just before opening quick add so the mic starts recording.
    var startRambleListening = false

    /// Quick add's defaults while it is open. It shows as an overlay attached to the keyboard, not as a sheet.
    var quickAdd: QuickAddDefaults? {
        if case let .quickAdd(defaults) = sheet { defaults } else { nil }
    }
}
