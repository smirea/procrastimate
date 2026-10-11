import AppIntents
import Core
import CoreSpotlight

struct TaskEntity: AppEntity, IndexedEntity {
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

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(name)", image: .init(systemName: "number"))
    }

    init(id: String, name: String) {
        self.id = id
        self.name = name
    }
}

struct LabelEntity: AppEntity {
    static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Label")
    static let defaultQuery = LabelEntityQuery()

    var id: String
    var name: String

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(name)", image: .init(systemName: "tag"))
    }

    init(id: String, name: String) {
        self.id = id
        self.name = name
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

    @available(iOS 27.0, *)
    func reindexEntities(for identifiers: [TaskEntity.ID], indexDescription _: CSSearchableIndexDescription) async throws {
        let (keep, drop) = await IntentEffects.spotlightEntities(ids: identifiers)
        try await SpotlightIndex.replace(keep, removing: drop)
    }

    @available(iOS 27.0, *)
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
