import SwiftUI
import WidgetKit

@main
struct ProcrastimateWidgets: WidgetBundle {
    var body: some Widget {
        TaskListWidget()
        ProgressWidget()
        QuickAddWidget()
        AddTaskControl()
        RambleControl()
        PlaceActivityWidget()
    }
}
