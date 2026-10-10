import Core
import SwiftUI

@main
struct ProcrastimateApp: App {
    @State private var navigator = Navigator()
    private let clock = Launch.prepare()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(navigator)
                .environment(\.clock, clock)
        }
    }
}
