import SwiftUI
import UIKit

/// Presents the app's sheets from a clear window of their own, above the one that holds the tabs. UIKit changes the
/// view controller a sheet is presented from: it dims the tint and flips two traits (the HDR headroom limit and the glass
/// elevation level) on everything under it. SwiftUI answers by rebuilding the environment of every `List` row in that
/// window, the rows of the mounted hidden tabs included, in the same main thread pass that starts the sheet moving, and
/// again on dismiss. That was most of opening task details. Presented from here, the tabs' window never changes.
struct SheetWindow<Content: View>: UIViewRepresentable {
    let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    func makeUIView(context: Context) -> Anchor { Anchor(content: content) }

    func updateUIView(_ anchor: Anchor, context: Context) { anchor.host.rootView = content }

    static func dismantleUIView(_ anchor: Anchor, coordinator: ()) { anchor.close() }

    /// Sits in the tabs' window to learn its scene, and owns the sheets' window for as long as it is there.
    final class Anchor: UIView {
        let host: UIHostingController<Content>
        private var sheets: PassthroughWindow?

        init(content: Content) {
            host = UIHostingController(rootView: content)
            host.view.backgroundColor = .clear
            super.init(frame: .zero)
            isUserInteractionEnabled = false
            accessibilityElementsHidden = true
        }

        required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

        override func didMoveToWindow() {
            super.didMoveToWindow()
            guard let tabs = window, let scene = tabs.windowScene else { return close() }
            guard sheets?.windowScene !== scene else {
                sheets?.tabs = tabs
                return
            }
            close()
            let sheets = PassthroughWindow(windowScene: scene)
            sheets.tabs = tabs
            sheets.rootViewController = host
            sheets.windowLevel = .normal + 1
            // `ThemeSettings.apply` restyles every window on a change; this one starts from the tabs' window's.
            sheets.overrideUserInterfaceStyle = tabs.overrideUserInterfaceStyle
            sheets.tintColor = tabs.tintColor
            sheets.isHidden = false
            self.sheets = sheets
        }

        func close() {
            sheets?.covering = false
            sheets?.isHidden = true
            sheets = nil
        }
    }
}

/// Touches fall through to the tabs' window unless a sheet is up.
final class PassthroughWindow: UIWindow {
    weak var tabs: UIWindow?

    /// While a sheet is up, VoiceOver must not reach the tabs under it: a sheet only hides its siblings in its own
    /// window. A text field in a sheet makes this window key, and the tabs' window takes that back with the sheet gone,
    /// so its keyboard shortcuts keep working.
    var covering = false {
        didSet {
            guard covering != oldValue else { return }
            tabs?.accessibilityElementsHidden = covering
            if !covering, isKeyWindow { tabs?.makeKey() }
        }
    }

    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        rootViewController?.presentedViewController == nil ? nil : super.hitTest(point, with: event)
    }
}

/// Tells the sheets' window whether a sheet is up, from inside it.
struct SheetCover: UIViewRepresentable {
    let covering: Bool

    func makeUIView(context: Context) -> Marker { Marker() }

    func updateUIView(_ marker: Marker, context: Context) { marker.covering = covering }

    final class Marker: UIView {
        var covering = false {
            didSet { (window as? PassthroughWindow)?.covering = covering }
        }

        override func didMoveToWindow() {
            super.didMoveToWindow()
            (window as? PassthroughWindow)?.covering = covering
        }
    }
}
