import SwiftUI

struct LabelScreen: View {
    let labelID: String

    var body: some View {
        ContentUnavailableView("Label", systemImage: "tag")
            .navigationTitle("Label")
    }
}
