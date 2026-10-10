import SwiftUI

struct RootView: View {
    @Environment(Navigator.self) private var navigator

    var body: some View {
        @Bindable var navigator = navigator
        TabView(selection: $navigator.tab) {
            Tab("Inbox", systemImage: "tray", value: .inbox) {
                TabStack(tab: .inbox) { InboxScreen() }
            }
            Tab("Today", systemImage: "sun.max", value: .today) {
                TabStack(tab: .today) { TodayScreen() }
            }
            Tab("Upcoming", systemImage: "calendar", value: .upcoming) {
                TabStack(tab: .upcoming) { UpcomingScreen() }
            }
            Tab("Browse", systemImage: "square.grid.2x2", value: .browse) {
                TabStack(tab: .browse) { BrowseScreen() }
            }
            Tab(value: .search, role: .search) {
                TabStack(tab: .search) { SearchScreen() }
            }
        }
        .tabViewStyle(.sidebarAdaptable)
        .tabBarMinimizeBehavior(.onScrollDown)
        .sheet(item: $navigator.sheet) { SheetView(sheet: $0) }
        .tint(Palette.accent)
    }
}

/// A tab's `NavigationStack`, bound to its path in the navigator.
private struct TabStack<Content: View>: View {
    @Environment(Navigator.self) private var navigator
    let tab: AppTab
    @ViewBuilder let content: () -> Content

    var body: some View {
        NavigationStack(path: Binding(get: { navigator.paths[tab] ?? [] }, set: { navigator.paths[tab] = $0 })) {
            content().navigationDestination(for: Route.self) { RouteView(route: $0) }
        }
    }
}

private struct RouteView: View {
    let route: Route

    var body: some View {
        switch route {
        case let .project(id): ProjectScreen(projectID: id)
        case let .label(id): LabelScreen(labelID: id)
        case .notifications: NotificationsScreen()
        }
    }
}

private struct SheetView: View {
    let sheet: Sheet

    var body: some View {
        switch sheet {
        case let .quickAdd(defaults): QuickAddSheet(defaults: defaults)
        case let .details(taskID): TaskDetailsSheet(taskID: taskID)
        case .search: NavigationStack { SearchScreen() }
        case .settings: SettingsSheet()
        }
    }
}
