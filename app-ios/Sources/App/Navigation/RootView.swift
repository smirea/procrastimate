import Core
import SwiftUI

struct RootView: View {
    @Environment(Navigator.self) private var navigator
    @Environment(Store.self) private var store
    @Environment(Session.self) private var session
    @Environment(TaskActions.self) private var actions
    @Environment(\.today) private var todayKey

    var body: some View {
        if session.signedIn {
            signedIn
        } else {
            SignInView()
        }
    }

    private var signedIn: some View {
        @Bindable var navigator = navigator
        let today = Views.todayTasks(store.tasks, todayKey)
        return TabView(selection: $navigator.tab) {
            Tab("Inbox", systemImage: "tray", value: .inbox) {
                TabStack(tab: .inbox) { InboxScreen() }
            }
            .badge(Views.inboxTasks(store.tasks).count)
            Tab("Today", systemImage: "sun.max", value: .today) {
                TabStack(tab: .today) { TodayScreen() }
            }
            .badge(today.overdue.count + today.today.count)
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
        .overlay(alignment: .bottom) { QuickAddOverlay() }
        .overlay(alignment: navigator.quickAdd == nil ? .bottom : .top) {
            // Quick add covers the bottom of the screen, so toasts move to the top while it is open, as on the web.
            ToastStack().padding(navigator.quickAdd == nil ? .bottom : .top, navigator.quickAdd == nil ? 124 : 8)
        }
        .sensoryFeedback(.success, trigger: actions.completions)
        .searchShortcuts()
        .sheet(item: Binding(
            get: { navigator.quickAdd == nil ? navigator.sheet : nil },
            set: { if $0 != nil || navigator.quickAdd == nil { navigator.sheet = $0 } }
        )) { SheetView(sheet: $0) }
    }
}

/// Quick add over a scrim, attached to the top of the keyboard. Tapping the scrim discards the draft.
private struct QuickAddOverlay: View {
    @Environment(Navigator.self) private var navigator

    var body: some View {
        ZStack(alignment: .bottom) {
            if let defaults = navigator.quickAdd {
                Color.scrim
                    .ignoresSafeArea()
                    .onTapGesture { navigator.sheet = nil }
                    .accessibilityHidden(true)
                    .transition(.opacity)
                QuickAddSheet(defaults: defaults)
                    .transition(.move(edge: .bottom))
            }
        }
        .animation(.snappy(duration: 0.3), value: navigator.quickAdd)
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
