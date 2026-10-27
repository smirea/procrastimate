import Core
import SwiftUI
import WidgetKit

/// Keeps the widgets' copy of the lists current. After a burst of edits, a theme color change, or signing in or out,
/// the app rewrites the app group file and reloads the widgets only when its bytes changed.
@MainActor
enum WidgetSync {
    private static var pending: Task<Void, Never>?
    private static var checked: [WidgetData.Checked] = []

    /// Keeps a row a widget just checked off on the widget, struck through, for a moment before it leaves. The widget
    /// compares against the real clock, so this reads it too.
    static func check(_ task: TaskItem) {
        checked.append(WidgetData.Checked(task: task, at: Date()))
    }

    static func schedule(_ store: Store, clock: AppClock) {
        pending?.cancel()
        pending = Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            write(store, clock: clock)
        }
    }

    /// At once, for an intent: the system may suspend the app as soon as it returns.
    static func write(_ store: Store, clock: AppClock) {
        pending?.cancel()
        let own = store.snapshot
        let data = WidgetData.make(
            signedIn: SessionToken.read() != nil || Launch.signedIn,
            tasks: own.tasks,
            projects: own.projects,
            labels: own.labels,
            accent: ThemeSettings.shared.accent.rawValue,
            checked: checked,
            now: Date(),
            today: clock.today,
            in: clock.timeZone
        )
        checked = data.checked ?? []
        do {
            if try WidgetStore.write(data) { WidgetCenter.shared.reloadAllTimelines() }
        } catch {
            Telemetry.capture("Couldn't update the widgets", detail: "\(error)", error: error)
        }
    }

    /// Rewrites the file on every change a widget shows: tasks, projects, labels, the theme color, and the session.
    struct Follow: ViewModifier {
        let store: Store
        let theme: ThemeSettings
        let auth: Session
        let clock: AppClock

        func body(content: Content) -> some View {
            content
                .onChange(of: store.tasks) { schedule() }
                .onChange(of: store.projects) { schedule() }
                .onChange(of: store.labels) { schedule() }
                .onChange(of: theme.accent) { schedule() }
                .onChange(of: auth.signedIn) { schedule() }
                .task { schedule() }
        }

        private func schedule() { WidgetSync.schedule(store, clock: clock) }
    }
}
