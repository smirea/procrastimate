import Foundation

/// Ports `shared/webhooks.ts`.
public enum Webhooks {
    /// Whether a live webhook watches the user's own project. A hook with no projects watches them all.
    public static func watches(_ hooks: [API.Webhook], _ projectId: String) -> Bool {
        hooks.contains { $0.disabledAt == nil && ($0.projectIds.isEmpty || $0.projectIds.contains(projectId)) }
    }
}
