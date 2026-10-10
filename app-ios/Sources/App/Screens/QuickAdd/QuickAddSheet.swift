import SwiftUI

struct QuickAddSheet: View {
    let defaults: QuickAddDefaults

    var body: some View {
        ContentUnavailableView("Quick add", systemImage: "plus")
            .presentationDetents([.medium])
    }
}
