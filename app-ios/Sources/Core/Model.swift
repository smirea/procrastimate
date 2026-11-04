import Foundation

// The model is generated from the shared Zod and Drizzle schemas into `Generated/API.swift`. These names are the
// ones Core and the app use. `Task` is Swift concurrency's, so a task is a `TaskItem`, and SwiftUI has a `Section`, so
// a project's section is a `ProjectSection`.

public typealias DateKey = API.DateKey
public typealias TimeOfDay = API.TimeOfDay
public typealias Weekday = API.Weekday
public typealias Priority = API.Priority
public typealias Due = API.Due
public typealias Reminder = API.Reminder
/// An image on a task. The bytes are on the server, fetched by `id`.
public typealias ImageRef = API.ImageRef
/// Any other file on a task, stored on the server in `FileKinds.partCount(bytes)` parts.
public typealias FileRef = API.FileRef
public typealias Attachment = API.Attachment
public typealias RecurrenceUnit = API.RecurrenceUnit
public typealias Recurrence = API.Recurrence
public typealias NthWeekday = API.NthWeekday
public typealias TaskItem = API.Task
public typealias Project = API.Project
public typealias ProjectIcon = API.ProjectIcon
/// SwiftUI has its own `Section`, so a project's section is a `ProjectSection`.
public typealias ProjectSection = API.ProjectSection
public typealias SectionCounter = API.SectionCounter
public typealias Label = API.Label
public typealias Person = API.Person

extension API.Attachment: Identifiable {
    public var id: String {
        switch self {
        case let .image(image): image.id
        case let .file(file): file.id
        }
    }

    public var image: ImageRef? {
        if case let .image(image) = self { image } else { nil }
    }

    public var file: FileRef? {
        if case let .file(file) = self { file } else { nil }
    }
}
