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
        let today = Views.todayTasks(store.tasks, todayKey, in: store.timeZone)
        return TabView(selection: Binding(
            get: { navigator.tab },
            set: { tab in
                if tab == .add {
                    navigator.sheet = .quickAdd(navigator.listDefaults)
                } else {
                    navigator.tab = tab
                }
            }
        )) {
            Tab("Inbox", systemImage: "tray", value: .inbox) {
                TabStack(tab: .inbox) { InboxScreen() }
            }
            .badge(today.overdue.count + today.today.count)
            Tab("No date", systemImage: "calendar.badge.minus", value: .noDate) {
                TabStack(tab: .noDate) { NoDateScreen() }
            }
            Tab("Browse", systemImage: "square.grid.2x2", value: .browse) {
                TabStack(tab: .browse) { BrowseScreen() }
            }
            Tab("Add task", systemImage: "plus", value: .add, role: Self.addRole) {
                Color.clear
            }
        }
        .tabViewStyle(.sidebarAdaptable)
        .tabBarMinimizeBehavior(.onScrollDown)
        .overlay(alignment: .bottomTrailing) {
            if navigator.quickAdd == nil {
                AddButton { navigator.sheet = .quickAdd(navigator.listDefaults) }
                    .transition(.scale(scale: 0.6).combined(with: .opacity))
            }
        }
        .animation(.snappy(duration: 0.2), value: navigator.quickAdd == nil)
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

    /// The tab only reserves the separate circle at the trailing end of the tab bar; `AddButton` draws over it. iOS 26
    /// separates a search-role tab, but iOS 27 lays search tabs inline and separates `.prominent` ones instead.
    private static var addRole: TabRole {
        if #available(iOS 27, *) { .prominent } else { .search }
    }
}

/// The accent add button. A tab item cannot take its own color, so this sits exactly over the search-role tab's circle,
/// which keeps the tab bar's layout and stays as the fallback if the two ever drift apart.
private struct AddButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "plus")
                .font(.title2.weight(.semibold))
                .foregroundStyle(.white)
                .frame(width: 62, height: 62)
                .glassEffect(.regular.tint(.accent).interactive(), in: .circle)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Quick add")
        .padding([.trailing, .bottom], 21)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
        .ignoresSafeArea()
    }
}

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
        case let .place(key): PlaceScreen(key: key)
        case let .event(id): EventScreen(eventID: id)
        }
    }
}

private struct SheetView: View {
    let sheet: Sheet

    var body: some View {
        switch sheet {
        case let .quickAdd(defaults): QuickAddSheet(defaults: defaults)
        case let .details(taskID): TaskDetailsSheet(taskID: taskID)
        case .settings: SettingsSheet()
        }
    }
}
