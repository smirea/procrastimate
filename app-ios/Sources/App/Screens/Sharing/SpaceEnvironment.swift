import Core
import SwiftUI

extension EnvironmentValues {
    /// The space the screen's task, project, or label lives in. Pickers and suggestions under it list only that space's
    /// projects and labels, since nothing moves between spaces.
    @Entry var space: SpaceKey = .own
    /// Quick add, whose task can land in any space: name suggestions and the project menu list every space's names a
    /// new task may land on (`Store.everySpace`), and a pick moves the task to that project's space.
    @Entry var namesFromEverySpace = false
}
