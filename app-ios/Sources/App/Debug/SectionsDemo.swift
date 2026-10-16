import Core
import Foundation

/// DEBUG-only. `PROCRASTIMATE_DEMO=sections` seeds a `Home` project with sections through the store's own commands and
/// opens it, so the simulator can screenshot a sectioned project without taps. Release builds omit it.
enum SectionsDemo {
    @MainActor
    static func run(store: Store, navigator: Navigator) {
        #if DEBUG
        guard PlacesDemo.has("sections") else { return }
        let home = store.projects.first { $0.name == "Home" } ?? store.addProject("Home")
        if store.sections(of: home.id).isEmpty {
            store.addTask(NewTask(title: "Water plants", projectId: home.id))
            for (name, titles) in [("Next up", ["Paint door", "Fix fence", "Oil hinges", "Patch wall", "Hang shelf"]), ("Later", ["Clean gutters"])] {
                guard let section = store.addSection(home.id, name) else { continue }
                for title in titles { store.addTask(NewTask(title: title, projectId: home.id, sectionId: section.id)) }
            }
        }
        navigator.tab = .browse
        navigator.paths[.browse] = [.project(id: home.id)]
        #endif
    }
}
