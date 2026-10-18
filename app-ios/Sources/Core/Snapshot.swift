import Foundation

/// One space's data: everything a store rule reads, plus the owner's settings. The local database holds one per owner.
public typealias Snapshot = API.Snapshot

extension API.Snapshot {
    public static var empty: Snapshot { Snapshot(settings: API.Settings()) }

    public var data: StoreData {
        get { StoreData(tasks: tasks, projects: projects, sections: sections, labels: labels, comments: comments, reads: reads) }
        set {
            tasks = newValue.tasks
            projects = newValue.projects
            sections = newValue.sections
            labels = newValue.labels
            comments = newValue.comments
            reads = newValue.reads
        }
    }
}
