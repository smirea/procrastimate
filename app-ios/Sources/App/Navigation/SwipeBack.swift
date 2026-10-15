import UIKit

/// SwiftUI turns off the edge swipe back on any screen that hides the system back button, such as task details with
/// its back chip. Every pushed screen keeps the swipe.
extension UINavigationController: @retroactive UIGestureRecognizerDelegate {
    override open func viewDidLoad() {
        super.viewDidLoad()
        interactivePopGestureRecognizer?.delegate = self
    }

    public func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        viewControllers.count > 1 && transitionCoordinator == nil
    }
}
