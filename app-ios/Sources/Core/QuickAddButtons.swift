import Foundation

public typealias QuickAddButton = API.QuickAddButton

/// Port of `shared/quick-add-buttons.ts`: which attribute buttons quick add's chip row shows, and in what order. The
/// stored list is the pinned buttons in row order; the enum's case order is the default order of the rest.
public enum QuickAddButtons {
    public static let defaults = API.Settings().quickAddButtons

    private static func unique(_ buttons: [QuickAddButton]) -> [QuickAddButton] {
        var seen = Set<QuickAddButton>()
        return buttons.filter { seen.insert($0).inserted }
    }

    /// Pins or unpins one button. A newly pinned button goes last; repeats drop.
    public static func toggleButton(_ visible: [QuickAddButton], _ button: QuickAddButton) -> [QuickAddButton] {
        let pinned = unique(visible)
        return pinned.contains(button) ? pinned.filter { $0 != button } : pinned + [button]
    }

    /// Moves a pinned button just before `before`, or to the end when `before` is nil.
    public static func moveButton(
        _ visible: [QuickAddButton],
        _ button: QuickAddButton,
        _ before: QuickAddButton?
    ) -> [QuickAddButton] {
        var rest = unique(visible).filter { $0 != button }
        rest.insert(button, at: before.flatMap { rest.firstIndex(of: $0) } ?? rest.endIndex)
        return rest
    }

    /// Each supported pinned button in the stored order, then each supported one shown because it holds a value or
    /// was opened from the `+` menu, in the default order. Passing `supported` as `shown` lists every button, pinned
    /// first, as settings and the `+` menu do.
    public static func rowButtons(
        _ visible: [QuickAddButton],
        _ shown: [QuickAddButton],
        _ supported: [QuickAddButton]
    ) -> [QuickAddButton] {
        let pinned = unique(visible).filter(supported.contains)
        let extra = QuickAddButton.allCases.filter { shown.contains($0) && supported.contains($0) && !pinned.contains($0) }
        return pinned + extra
    }
}
