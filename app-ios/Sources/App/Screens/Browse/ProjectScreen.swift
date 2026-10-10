import SwiftUI

struct ProjectScreen: View {
    let projectID: String

    var body: some View {
        ContentUnavailableView("Project", systemImage: "number")
            .navigationTitle("Project")
    }
}
