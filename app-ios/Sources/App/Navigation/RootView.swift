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
        return TabView(selection: Binding(get: { navigator.tab }, set: { navigator.tab = $0 })) {
            Tab(value: AppTab.inbox) {
                TabStack(tab: .inbox) { InboxScreen() }
            }
            Tab(value: AppTab.noDate) {
                TabStack(tab: .noDate) { NoDateScreen() }
            }
            Tab(value: AppTab.browse) {
                TabStack(tab: .browse) { BrowseScreen() }
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            TabBar(inboxBadge: today.overdue.count + today.today.count)
        }
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

/// The app draws its own tab bar so quick add is one accent circle beside the tabs. The system bar cannot tint a tab,
/// and the role that gets a separate circle changed between iOS 26 (`.search`) and 27 (`.prominent`).
private struct TabBar: View {
    @Environment(Navigator.self) private var navigator
    @Namespace private var selection
    @State private var keyboardShown = false
    @State private var bottomInset: CGFloat = 0
    let inboxBadge: Int

    var body: some View {
        GlassEffectContainer(spacing: 12) {
            HStack(spacing: 12) {
                HStack(spacing: 0) {
                    item(.inbox, "Inbox", "tray", badge: inboxBadge)
                    item(.noDate, "No date", "calendar.badge.minus")
                    item(.browse, "Browse", "square.grid.2x2")
                }
                .padding(4)
                .glassEffect(.regular.interactive(), in: .capsule)
                Button { navigator.sheet = .quickAdd(navigator.listDefaults) } label: {
                    Image(systemName: "plus")
                        .font(.title2.weight(.semibold))
                        .foregroundStyle(.white)
                        .frame(width: 62, height: 62)
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
        // 21 pt from the screen's bottom edge, where the system tab bar sits, whatever the home indicator inset.
        .padding(.bottom, max(0, 21 - bottomInset))
        .offset(y: max(0, bottomInset - 21))
        .onGeometryChange(for: CGFloat.self, of: { $0.safeAreaInsets.bottom }) { bottomInset = $0 }
        .opacity(hidden ? 0 : 1)
        .allowsHitTesting(!hidden)
        .animation(.snappy(duration: 0.2), value: hidden)
        .onMessage(of: UIScreen.self, for: .keyboardWillShow) { _ in keyboardShown = true }
        .onMessage(of: UIScreen.self, for: .keyboardWillHide) { _ in keyboardShown = false }
    }

    private var hidden: Bool { keyboardShown || navigator.quickAdd != nil }

    private func item(_ tab: AppTab, _ title: String, _ symbol: String, badge: Int = 0) -> some View {
        let selected = navigator.tab == tab
        return Button {
            if selected { navigator.paths[tab] = [] } else { navigator.tab = tab }
        } label: {
            VStack(spacing: 2) {
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
        }
        .buttonStyle(.plain)
        .animation(.snappy(duration: 0.25), value: navigator.tab)
        .accessibilityLabel(badge > 0 ? "\(title), \(badge)" : title)
        .accessibilityAddTraits(selected ? [.isSelected, .isButton] : .isButton)
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
