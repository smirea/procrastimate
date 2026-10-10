import SwiftUI

struct SearchScreen: View {
    @State private var query = ""

    var body: some View {
        ContentUnavailableView("Search tasks, projects, and labels", systemImage: "magnifyingglass")
            .navigationTitle("Search")
            .searchable(text: $query, prompt: "Search")
    }
}
