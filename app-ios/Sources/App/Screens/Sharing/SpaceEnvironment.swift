import Core
import SwiftUI

extension EnvironmentValues {
    /// The space the screen's task, project, or label lives in. Pickers and suggestions under it list only that space's
    /// projects and labels, since nothing moves between spaces.
    @Entry var space: SpaceKey = .own
}
