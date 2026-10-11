import AppIntents

/// The phrases Siri and the Shortcuts app offer without Stefan setting them up. Each one names the app, which App
/// Shortcuts require. Ten is the most the system keeps; this list stays under that. Phrases can only interpolate
/// `AppEntity` and `AppEnum` parameters, so the String ones (a task title, a search query) are asked for after the phrase.
struct ProcrastimateShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: AddTaskIntent(),
            phrases: [
                "Add a task in \(.applicationName)",
                "Create a task in \(.applicationName)",
            ],
            shortTitle: "Add Task",
            systemImageName: "plus"
        )
        AppShortcut(
            intent: CompleteTaskIntent(),
            phrases: [
                "Complete \(\.$task) in \(.applicationName)",
                "Mark \(\.$task) done in \(.applicationName)",
            ],
            shortTitle: "Complete Task",
            systemImageName: "checkmark.circle"
        )
        AppShortcut(
            intent: ReopenTaskIntent(),
            phrases: [
                "Reopen \(\.$task) in \(.applicationName)",
                "Uncomplete \(\.$task) in \(.applicationName)",
            ],
            shortTitle: "Uncomplete Task",
            systemImageName: "arrow.uturn.backward"
        )
        AppShortcut(
            intent: OpenViewIntent(),
            phrases: [
                "Open \(\.$list) in \(.applicationName)",
                "Show \(\.$list) in \(.applicationName)",
            ],
            shortTitle: "Open List",
            systemImageName: "list.bullet"
        )
        AppShortcut(
            intent: OpenProjectIntent(),
            phrases: [
                "Open project \(\.$project) in \(.applicationName)",
                "Show project \(\.$project) in \(.applicationName)",
            ],
            shortTitle: "Open Project",
            systemImageName: "number"
        )
        AppShortcut(
            intent: OpenTaskIntent(),
            phrases: [
                "Open task \(\.$target) in \(.applicationName)",
                "Show task \(\.$target) in \(.applicationName)",
            ],
            shortTitle: "Open Task",
            systemImageName: "checkmark.circle"
        )
        AppShortcut(
            intent: SearchTasksIntent(),
            phrases: [
                "Search tasks in \(.applicationName)",
                "Find a task in \(.applicationName)",
            ],
            shortTitle: "Search Tasks",
            systemImageName: "magnifyingglass"
        )
        AppShortcut(
            intent: ListTodayIntent(),
            phrases: [
                "What is due today in \(.applicationName)",
                "List today in \(.applicationName)",
            ],
            shortTitle: "Today's Tasks",
            systemImageName: "sun.max"
        )
        AppShortcut(
            intent: DeleteAllDataIntent(),
            phrases: [
                "Delete all data in \(.applicationName)",
                "Erase everything in \(.applicationName)",
            ],
            shortTitle: "Delete All Data",
            systemImageName: "trash"
        )
        AppShortcut(
            intent: ListOverdueIntent(),
            phrases: [
                "What is overdue in \(.applicationName)",
                "List overdue tasks in \(.applicationName)",
            ],
            shortTitle: "Overdue Tasks",
            systemImageName: "exclamationmark.circle"
        )
    }
}
