import Foundation

public typealias QuickAddButton = API.QuickAddButton

/// Port of `shared/quick-add-buttons.ts`: which attribute buttons quick add's chip row shows. The enum's case order
/// is the row order.
public enum QuickAddButtons {
    public static let defaults = API.Settings().quickAddButtons

    /// Pins or unpins one button, returning the list in row order with no repeats.
    public static func toggleButton(_ visible: [QuickAddButton], _ button: QuickAddButton) -> [QuickAddButton] {
        var next = Set(visible)
        if next.contains(button) { next.remove(button) } else { next.insert(button) }
        return QuickAddButton.allCases.filter(next.contains)
    }

    /// Each supported button that is pinned, or shown because it holds a value or was opened from the `+` menu.
    public static func rowButtons(
        _ visible: [QuickAddButton],
        _ shown: [QuickAddButton],
        _ supported: [QuickAddButton]
    ) -> [QuickAddButton] {
        let on = Set(visible + shown)
        return QuickAddButton.allCases.filter { on.contains($0) && supported.contains($0) }
    }
}
