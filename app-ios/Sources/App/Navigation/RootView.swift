import Core
import SwiftUI

struct RootView: View {
    @Environment(Navigator.self) private var navigator
    @Environment(Store.self) private var store
    @Environment(Session.self) private var session
    @Environment(TaskActions.self) private var actions
    @Environment(\.today) private var todayKey

    var body: some View {
        Group {
            if session.signedIn {
                signedIn
            } else {
                SignInView()
            }
        }
        // Outside the sign-in gate, so a share link opens its read-only page signed out too.
        .sheet(item: Binding(
            get: { navigator.quickAdd == nil && navigator.ramble == nil ? navigator.sheet : nil },
            set: { if $0 != nil || (navigator.quickAdd == nil && navigator.ramble == nil) { navigator.sheet = $0 } }
        )) { SheetView(sheet: $0) }
    }

    private var signedIn: some View {
        let today = Views.todayTasks(store.tasks, todayKey, in: store.timeZone)
        return TabView(selection: Binding(get: { navigator.tab }, set: { navigator.tab = $0 })) {
            Tab(value: AppTab.inbox) {
                TabStack(tab: .inbox) { InboxScreen().tracedScreen("Inbox") }
            }
            Tab(value: AppTab.noDate) {
                TabStack(tab: .noDate) { NoDateScreen().tracedScreen("No date") }
            }
            Tab(value: AppTab.browse) {
                TabStack(tab: .browse) { BrowseScreen().tracedScreen("Browse") }
            }
        }
        // An overlay, not a `safeAreaInset`: the tab view hands its tabs a fresh safe area, so each tab's screens make room
        // with `tabBarClearance()` instead.
        .overlay(alignment: .bottom) {
            TabBar(
                inboxBadge: today.overdue.count + today.today.count,
                hasNoDate: !Views.inboxTasks(store.tasks, todayKey, in: store.timeZone).isEmpty
            )
        }
        .overlay(alignment: .bottom) { QuickAddOverlay() }
        .overlay { RambleOverlay() }
        .overlay(alignment: navigator.quickAdd == nil ? .bottom : .top) {
            // Quick add covers the bottom of the screen, so toasts move to the top while it is open, as on the web.
            ToastStack()
                .padding(.top, navigator.quickAdd == nil ? 0 : 8)
                .tabBarClearance()
        }
        .sensoryFeedback(.success, trigger: actions.completions)
        .searchShortcuts()
    }
}

/// The floating tab bar's size and place, shared by the bar and the inset that keeps every tab's content clear of it.
enum TabBarMetrics {
    static let height: CGFloat = 62
    /// From the screen's bottom edge, where the system tab bar sits, whatever the home indicator inset.
    static let bottomMargin: CGFloat = 21
    static let contentGap: CGFloat = 12
    /// How far above the screen's bottom edge content must end to clear the bar.
    static let clearance = bottomMargin + height + contentGap
}

extension View {
    /// Lets a tab's screen scroll its last content above the floating tab bar and add button. The room shrinks by the
    /// safe area already below the content and goes away while the keyboard, which hides the bar, takes that space.
    func tabBarClearance() -> some View { modifier(TabBarClearance()) }
}

private struct TabBarClearance: ViewModifier {
    @State private var bottomInset: CGFloat = 0

    func body(content: Content) -> some View {
        content
            .safeAreaInset(edge: .bottom, spacing: 0) {
                Color.clear
                    .frame(height: max(0, TabBarMetrics.clearance - bottomInset))
                    .allowsHitTesting(false)
            }
            .onGeometryChange(for: CGFloat.self, of: { $0.safeAreaInsets.bottom }) { bottomInset = $0 }
    }
}

/// The app draws its own tab bar so quick add is one accent circle beside the tabs. The system bar cannot tint a tab,
/// and the role that gets a separate circle changed between iOS 26 (`.search`) and 27 (`.prominent`).
private struct TabBar: View {
    @Environment(Navigator.self) private var navigator
    @Environment(Store.self) private var store
    @Namespace private var selection
    @State private var keyboardShown = false
    let inboxBadge: Int
    let hasNoDate: Bool

    var body: some View {
        GlassEffectContainer(spacing: 12) {
            HStack(spacing: 12) {
                HStack(spacing: 0) {
                    inboxItem
                    // No date leaves once it is empty, but not while it is open, so finishing its last task keeps the tab.
                    if hasNoDate || navigator.tab == .noDate {
                        item(.noDate, "No date", "calendar.badge.minus")
                            .transition(.scale(scale: 0.6).combined(with: .opacity))
                    }
                    item(.browse, "Browse", "square.grid.2x2")
                }
                .padding(4)
                .animation(.snappy(duration: 0.25), value: hasNoDate || navigator.tab == .noDate)
                .glassEffect(.regular.interactive(), in: .capsule)
                Button { navigator.sheet = .quickAdd(navigator.listDefaults) } label: {
                    Image(systemName: "plus")
                        .font(.title2.weight(.semibold))
                        .foregroundStyle(.white)
                        .frame(width: TabBarMetrics.height, height: TabBarMetrics.height)
                        .contentShape(.circle)
                        // On the label, not the button: glass around a plain-style button shrinks its tap area to the glyph.
                        .glassEffect(.regular.tint(.accent).interactive(), in: .circle)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Quick add")
            }
        }
        .frame(maxWidth: 520)
        .padding(.horizontal, 21)
        .padding(.bottom, TabBarMetrics.bottomMargin)
        .ignoresSafeArea(.all, edges: .bottom)
        .opacity(hidden ? 0 : 1)
        .allowsHitTesting(!hidden)
        .animation(.snappy(duration: 0.2), value: hidden)
        .onMessage(of: UIScreen.self, for: .keyboardWillShow) { _ in keyboardShown = true }
        .onMessage(of: UIScreen.self, for: .keyboardWillHide) { _ in keyboardShown = false }
    }

    private var hidden: Bool { keyboardShown || navigator.quickAdd != nil }

    /// Tapping Inbox again, or long pressing it at any time, lists the projects to jump to. A plain `Menu` opens on tap,
    /// and one with a primary action opens only on a long press.
    @ViewBuilder private var inboxItem: some View {
        let label = itemLabel(.inbox, "Inbox", "tray", badge: inboxBadge)
        if navigator.tab == .inbox {
            Menu { projectsMenu } label: { label }
                .menuStyle(.button)
                .buttonStyle(.plain)
                .itemAccessibility("Inbox", badge: inboxBadge, selected: true)
        } else {
            Menu { projectsMenu } label: { label } primaryAction: { navigator.tab = .inbox }
                .menuStyle(.button)
                .buttonStyle(.plain)
                .itemAccessibility("Inbox", badge: inboxBadge, selected: false)
        }
    }

    @ViewBuilder private var projectsMenu: some View {
        Button("Inbox", systemImage: "tray") {
            navigator.tab = .inbox
            navigator.paths[.inbox] = []
        }
        Section("Projects") {
            ForEach(store.projects) { project in
                Button(project.name, systemImage: "number") {
                    navigator.tab = .inbox
                    navigator.paths[.inbox] = [.project(id: project.id)]
                }
            }
        }
    }

    private func item(_ tab: AppTab, _ title: String, _ symbol: String, badge: Int = 0) -> some View {
        let selected = navigator.tab == tab
        return Button {
            if selected { navigator.paths[tab] = [] } else { navigator.tab = tab }
        } label: {
            itemLabel(tab, title, symbol, badge: badge)
        }
        .buttonStyle(.plain)
        .itemAccessibility(title, badge: badge, selected: selected)
    }

    private func itemLabel(_ tab: AppTab, _ title: String, _ symbol: String, badge: Int = 0) -> some View {
        let selected = navigator.tab == tab
        return VStack(spacing: 2) {
            Image(systemName: symbol)
                .symbolVariant(selected ? .fill : .none)
                .font(.title3)
                .frame(height: 28)
                .overlay(alignment: .topTrailing) {
                    if badge > 0 {
                        Text("\(badge)")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 5)
                            .frame(minWidth: 18, minHeight: 18)
                            .background(.red, in: .capsule)
                            .offset(x: 12, y: -4)
                    }
                }
            Text(title).font(.caption2.weight(.medium))
        }
        .foregroundStyle(selected ? Color.accent : Color.primary)
        .frame(maxWidth: .infinity, minHeight: 54)
        .background {
            if selected {
                Capsule().fill(.ink.opacity(0.08)).matchedGeometryEffect(id: "selection", in: selection)
            }
        }
        .contentShape(.capsule)
        .animation(.snappy(duration: 0.25), value: navigator.tab)
    }
}

private extension View {
    func itemAccessibility(_ title: String, badge: Int, selected: Bool) -> some View {
        accessibilityLabel(badge > 0 ? "\(title), \(badge)" : title)
            .accessibilityAddTraits(selected ? [.isSelected, .isButton] : .isButton)
    }
}

private struct QuickAddOverlay: View {
    @Environment(Navigator.self) private var navigator
    @Environment(Store.self) private var store

    var body: some View {
        ZStack(alignment: .bottom) {
            if let defaults = navigator.quickAdd {
                Color.scrim
                    .ignoresSafeArea()
                    .onTapGesture { navigator.sheet = nil }
                    .accessibilityHidden(true)
                    .transition(.opacity)
                QuickAddSheet(defaults: defaults)
                    .environment(\.space, space(of: defaults))
                    .transition(.move(edge: .bottom))
            }
        }
        .animation(.snappy(duration: 0.3), value: navigator.quickAdd)
    }

    private func space(of defaults: QuickAddDefaults) -> SpaceKey {
        store.space(of: defaults)
    }
}

private struct RambleOverlay: View {
    @Environment(Navigator.self) private var navigator
    @Environment(Store.self) private var store

    var body: some View {
        ZStack {
            if let defaults = navigator.ramble {
                RambleDrawer(defaults: defaults)
                    .environment(\.space, store.space(of: defaults))
                    .transition(.move(edge: .bottom))
            }
        }
        .animation(.spring(duration: 0.45, bounce: 0.12), value: navigator.ramble)
    }
}

extension Store {
    /// The space quick add or Ramble saves into: the shared project's or label's, else the user's own.
    func space(of defaults: QuickAddDefaults) -> SpaceKey {
        defaults.projectId.flatMap(space(ofProject:)) ?? defaults.labelId.flatMap(space(ofLabel:)) ?? .own
    }
}

private struct TabStack<Content: View>: View {
    @Environment(Navigator.self) private var navigator
    let tab: AppTab
    @ViewBuilder let content: () -> Content

    var body: some View {
        NavigationStack(path: Binding(get: { navigator.paths[tab] ?? [] }, set: { navigator.paths[tab] = $0 })) {
            content()
                .tabBarClearance()
                .navigationDestination(for: Route.self) { RouteView(route: $0).tabBarClearance() }
        }
        .toolbarVisibility(.hidden, for: .tabBar)
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
        case .completed: CompletedScreen()
        }
    }
}

private struct SheetView: View {
    @Environment(Store.self) private var store
    let sheet: Sheet

    var body: some View {
        switch sheet {
        case let .quickAdd(defaults): QuickAddSheet(defaults: defaults)
        case let .ramble(defaults): RambleDrawer(defaults: defaults)
        case let .details(taskID): TaskDetailsSheet(stack: Subtasks.ancestorsOf(store.allTasks, taskID).map(\.id) + [taskID])
        case .settings: SettingsSheet()
        case let .sharedLink(token): SharedLinkSheet(token: token)
        }
    }
}
