import AppIntents
import Core
import CoreSpotlight

struct TaskEntity: AppEntity, IndexedEntity, Equatable {
    static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Task")
    static let defaultQuery = TaskEntityQuery()

    var id: String

    @Property(title: "Title", indexingKey: \.title)
    var title: String

    @Property(title: "Details", indexingKey: \.contentDescription)
    var details: String

    @Property(title: "Keywords", indexingKey: \.keywords)
    var keywords: [String]

    var displayRepresentation: DisplayRepresentation {
        if details.isEmpty {
            DisplayRepresentation(title: "\(title)", image: .init(systemName: "checkmark.circle"))
        } else {
            DisplayRepresentation(title: "\(title)", subtitle: "\(details)", image: .init(systemName: "checkmark.circle"))
        }
    }

    init(id: String, title: String, details: String, keywords: [String]) {
        self.id = id
        self.title = title
        self.details = details
        self.keywords = keywords
    }

    /// `@Property` keeps the synthesized conformance away; the index compares what it sends.
    static func == (a: TaskEntity, b: TaskEntity) -> Bool {
        a.id == b.id && a.title == b.title && a.details == b.details && a.keywords == b.keywords
    }

    static func make(_ task: TaskItem, projects: [Project], labels: [Label], today: DateKey) -> TaskEntity {
        var parts: [String] = []
        if let due = task.due { parts.append(Format.formatDue(due, today)) }
        if task.completedAt != nil { parts.append("Completed") }
        if !task.notes.isEmpty { parts.append(task.notes) }
        var keywords = [task.title]
        if let name = projects.first(where: { $0.id == task.projectId })?.name {
            parts.append(name)
            keywords.append(name)
        }
        for label in labels where task.labelIds.contains(label.id) {
            parts.append(label.name)
            keywords.append(label.name)
        }
        return TaskEntity(id: task.id, title: task.title, details: parts.joined(separator: " · "), keywords: keywords)
    }
}

struct ProjectEntity: AppEntity {
    static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Project")
    static let defaultQuery = ProjectEntityQuery()

    var id: String
    var name: String
    var systemImage: String

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(name)", image: .init(systemName: systemImage))
    }

    init(_ project: Project) {
        id = project.id
        name = project.name
        systemImage = project.systemImage
    }
}

struct LabelEntity: AppEntity {
    static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Label")
    static let defaultQuery = LabelEntityQuery()

    var id: String
    var name: String
    var systemImage: String

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(name)", image: .init(systemName: systemImage))
    }

    init(_ label: Core.Label) {
        id = label.id
        name = label.name
        systemImage = label.systemImage()
    }
}

struct TaskEntityQuery: EntityStringQuery, IndexedEntityQuery {
    func entities(for identifiers: [TaskEntity.ID]) async throws -> [TaskEntity] {
        await IntentEffects.tasks(ids: identifiers)
    }

    func entities(matching string: String) async throws -> [TaskEntity] {
        await IntentEffects.tasks(matching: string)
    }

    func suggestedEntities() async throws -> [TaskEntity] {
        await IntentEffects.suggestedTasks()
    }

    func reindexEntities(for identifiers: [TaskEntity.ID], indexDescription _: CSSearchableIndexDescription) async throws {
        let (keep, drop) = await IntentEffects.spotlightEntities(ids: identifiers)
        try await SpotlightIndex.replace(keep, removing: drop)
    }

    func reindexAllEntities(indexDescription _: CSSearchableIndexDescription) async throws {
        try await SpotlightIndex.replaceAll(await IntentEffects.spotlightEntities())
    }
}

struct ProjectEntityQuery: EntityStringQuery {
    func entities(for identifiers: [ProjectEntity.ID]) async throws -> [ProjectEntity] {
        await IntentEffects.projects(ids: identifiers)
    }

    func entities(matching string: String) async throws -> [ProjectEntity] {
        await IntentEffects.projects(matching: string)
    }

    func suggestedEntities() async throws -> [ProjectEntity] {
        await IntentEffects.suggestedProjects()
    }
}

struct LabelEntityQuery: EntityStringQuery {
    func entities(for identifiers: [LabelEntity.ID]) async throws -> [LabelEntity] {
        await IntentEffects.labels(ids: identifiers)
    }

    func entities(matching string: String) async throws -> [LabelEntity] {
        await IntentEffects.labels(matching: string)
    }

    func suggestedEntities() async throws -> [LabelEntity] {
        await IntentEffects.suggestedLabels()
    }
}
