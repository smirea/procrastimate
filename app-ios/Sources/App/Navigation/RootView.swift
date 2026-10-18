import Core
import SwiftUI

struct RootView: View {
    @Environment(Navigator.self) private var navigator
    @Environment(Store.self) private var store
    @Environment(Session.self) private var session
    @Environment(SyncClient.self) private var sync
    @Environment(TaskActions.self) private var actions
    @Environment(\.today) private var todayKey

    var body: some View {
        Group {
            if session.signedIn, sync.unreadable {
                ContentUnavailableView {
                    SwiftUI.Label("Couldn’t open your tasks", systemImage: "externaldrive.badge.exclamationmark")
                } description: {
                    Text("This device could not read its copy of your tasks. Nothing you change would be saved until it can.")
                } actions: {
                    Button("Try again") { sync.retryRead() }.buttonStyle(.borderedProminent)
                }
            } else if session.signedIn {
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
        // Signing out from Settings, or a rejected token, must not leave a signed-in sheet over the sign-in screen.
        .onChange(of: session.signedIn) { _, signedIn in
            if !signedIn, navigator.sheet?.keepsWhenSignedOut != true { navigator.sheet = nil }
        }
    }

    private var signedIn: some View {
        let today = Views.todayTasks(store.tasks, todayKey, in: store.timeZone)
        return TabView(selection: Binding(get: { navigator.tab }, set: { navigator.tab = $0 })) {
            ForEach(navigator.pins, id: \.self) { pin in
                Tab(value: AppTab.pin(pin)) {
                    TabStack(tab: .pin(pin)) { RouteView(route: pin.route) }
                }
            }
            Tab(value: AppTab.browse) {
                TabStack(tab: .browse) { BrowseScreen().tracedScreen("Browse") }
            }
        }
        // An overlay, not a `safeAreaInset`: the tab view hands its tabs a fresh safe area, so each tab's screens make room
        // with `tabBarClearance()` instead.
        .overlay(alignment: .bottom) {
            TabBar(inboxBadge: today.overdue.count + today.today.count)
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
    static let sideMargin: CGFloat = 21
    static let maxWidth: CGFloat = 520
    static let contentGap: CGFloat = 12
    static let inset: CGFloat = 4
    /// The narrowest a tab gets, which still reads a short project name.
    static let tabMinWidth: CGFloat = 70

    static func barWidth(screen: CGFloat) -> CGFloat { min(screen - 2 * sideMargin, maxWidth) }

    /// Whether the add button moves above the tabs, because `tabs` (Browse included) don't fit beside it. It counts
    /// every pin, shown or not, so a pin hiding or coming back never moves the button.
    static func stacked(tabs: Int, screen: CGFloat) -> Bool {
        CGFloat(tabs) * tabMinWidth + 2 * inset + contentGap + height > barWidth(screen: screen)
    }

    /// How many pins fit beside Browse in a full-width bar on a screen this wide.
    static func maxPins(screen: CGFloat) -> Int {
        max(0, Int((barWidth(screen: screen) - 2 * inset) / tabMinWidth) - 1)
    }

    /// How far above the screen's bottom edge content must end to clear the bar, and the add button above it.
    static func clearance(stacked: Bool) -> CGFloat {
        bottomMargin + height + contentGap + (stacked ? height + contentGap : 0)
    }
}

extension Navigator {
    /// The pins the bar can name. A project or label that is gone keeps its pin stored, out of sight.
    func barPins(_ store: Store) -> [Pin] { pins.filter { store.label(of: $0) != nil } }
}

extension View {
    /// Lets a tab's screen scroll its last content above the floating tab bar and add button. The room shrinks by the
    /// safe area already below the content and goes away while the keyboard, which hides the bar, takes that space.
    func tabBarClearance() -> some View { modifier(TabBarClearance()) }
}

private struct TabBarClearance: ViewModifier {
    @Environment(Navigator.self) private var navigator
    @Environment(Store.self) private var store
    @State private var bottomInset: CGFloat = 0
    @State private var width: CGFloat = 0

    func body(content: Content) -> some View {
        let stacked = TabBarMetrics.stacked(tabs: navigator.barPins(store).count + 1, screen: width)
        content
            .safeAreaInset(edge: .bottom, spacing: 0) {
                Color.clear
                    .frame(height: max(0, TabBarMetrics.clearance(stacked: stacked) - bottomInset))
                    .allowsHitTesting(false)
            }
            .onGeometryChange(for: CGFloat.self, of: { $0.safeAreaInsets.bottom }) { bottomInset = $0 }
            .onGeometryChange(for: CGFloat.self, of: { $0.size.width }) { width = $0 }
    }
}

/// The app draws its own tab bar so quick add is one accent circle beside the tabs. The system bar cannot tint a tab,
/// and the role that gets a separate circle changed between iOS 26 (`.search`) and 27 (`.prominent`).
private struct TabBar: View {
    @Environment(Navigator.self) private var navigator
    @Environment(Store.self) private var store
    @Environment(\.today) private var today
    @Namespace private var selection
    @State private var keyboardShown = false
    @State private var width: CGFloat = 0
    let inboxBadge: Int

    var body: some View {
        let pins = navigator.barPins(store)
        // A pin with no open tasks leaves the bar, but not while it is open, so finishing its last task keeps the tab.
        let shown = pins.filter { store.hasOpenTasks($0, today: today) || navigator.tab == .pin($0) }
        let swaps = store.pinGroups(excluding: navigator.pins, today: today)
        let stacked = TabBarMetrics.stacked(tabs: pins.count + 1, screen: width)
        GlassEffectContainer(spacing: TabBarMetrics.contentGap) {
            if stacked {
                VStack(alignment: .trailing, spacing: TabBarMetrics.contentGap) {
                    addButton
                    tabs(shown, swaps: swaps)
                }
            } else {
                HStack(spacing: TabBarMetrics.contentGap) {
                    tabs(shown, swaps: swaps)
                    addButton
                }
            }
        }
        .frame(maxWidth: TabBarMetrics.maxWidth)
        .padding(.horizontal, TabBarMetrics.sideMargin)
        .padding(.bottom, TabBarMetrics.bottomMargin)
        .ignoresSafeArea(.all, edges: .bottom)
        .frame(maxWidth: .infinity)
        .onGeometryChange(for: CGFloat.self, of: { $0.size.width }) { width = $0 }
        .opacity(hidden ? 0 : 1)
        .allowsHitTesting(!hidden)
        .animation(.snappy(duration: 0.2), value: hidden)
        .onMessage(of: UIScreen.self, for: .keyboardWillShow) { _ in keyboardShown = true }
        .onMessage(of: UIScreen.self, for: .keyboardWillHide) { _ in keyboardShown = false }
    }

    private var hidden: Bool { keyboardShown || navigator.quickAdd != nil }

    private func tabs(_ shown: [Pin], swaps: [PinGroup]) -> some View {
        HStack(spacing: 0) {
            ForEach(shown, id: \.key) { pin in
                if let label = store.label(of: pin) {
                    pinItem(pin, label, swaps: swaps)
                        .transition(.scale(scale: 0.6).combined(with: .opacity))
                }
            }
            browseItem
        }
        .padding(TabBarMetrics.inset)
        .animation(.snappy(duration: 0.25), value: shown)
        .glassEffect(.regular.interactive(), in: .capsule)
    }

    private var addButton: some View {
        Button { navigator.sheet = .quickAdd(navigator.listDefaults(store)) } label: {
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
        // The open quick add card's identifier is also `Quick add`, so a test matching the label can hit the card.
        .accessibilityIdentifier("quick-add-button")
    }

    /// Tapping an open pin at its root, or long pressing any pin, lists the screens it can switch to. A plain `Menu`
    /// opens on tap, and one with a primary action opens only on a long press.
    @ViewBuilder private func pinItem(_ pin: Pin, _ label: PinLabel, swaps: [PinGroup]) -> some View {
        let tab = AppTab.pin(pin)
        let selected = navigator.tab == tab
        let badge = pin == .inbox ? inboxBadge : 0
        let item = itemLabel(tab, label.title, label.systemImage, badge: badge)
        let menu = swapMenu(pin, swaps: swaps)
        Group {
            if selected, navigator.paths[tab, default: []].isEmpty {
                Menu { menu } label: { item }
            } else {
                Menu { menu } label: { item } primaryAction: {
                    if selected { navigator.paths[tab] = [] } else { navigator.tab = tab }
                }
            }
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .itemAccessibility(label.title, badge: badge, selected: selected)
    }

    @ViewBuilder private func swapMenu(_ pin: Pin, swaps: [PinGroup]) -> some View {
        ForEach(swaps) { group in
            Section(group.title) {
                ForEach(group.pins, id: \.key) { next in
                    if let label = store.label(of: next) {
                        Button(label.title, systemImage: label.systemImage) { navigator.swap(pin, to: next) }
                    }
                }
            }
        }
    }

    private var browseItem: some View {
        let selected = navigator.tab == .browse
        return Button {
            if selected { navigator.paths[.browse] = [] } else { navigator.tab = .browse }
        } label: {
            itemLabel(.browse, "Browse", "square.grid.2x2")
        }
        .buttonStyle(.plain)
        .itemAccessibility("Browse", badge: 0, selected: selected)
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
            Text(title)
                .font(.caption2.weight(.medium))
                .lineLimit(1)
                .padding(.horizontal, 6)
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

extension EnvironmentValues {
    /// True for the screen at the bottom of a tab's stack, which has no back button.
    @Entry var tabRoot = false
}

private struct TabStack<Content: View>: View {
    @Environment(Navigator.self) private var navigator
    let tab: AppTab
    @ViewBuilder let content: () -> Content

    var body: some View {
        NavigationStack(path: Binding(get: { navigator.paths[tab] ?? [] }, set: { navigator.paths[tab] = $0 })) {
            content()
                .environment(\.tabRoot, true)
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
        case .inbox: InboxScreen().tracedScreen("Inbox")
        case .noDate: NoDateScreen().tracedScreen("No date")
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
