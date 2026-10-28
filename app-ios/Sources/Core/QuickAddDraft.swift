import Foundation

/// The quick add sheet's state and rules from `app-web/src/lib/components/QuickAdd.svelte`: the typed text, the phrases
/// kept as text, and the values picked with chips. The text wins over a pick for the same attribute, and picking a
/// value removes the phrase that set it. Offsets are UTF-16, like the parser's tokens.
public struct QuickAddDraft: Hashable, Sendable {
    /// What the sheet opened with, from the screen it opened on (`Screens.defaults`). An event stands in for the date
    /// and the repeat.
    public struct Defaults: Hashable, Sendable {
        public var projectId: String?
        public var sectionId: String?
        public var labelIds: [String]
        public var location: TaskLocation?
        public var event: TaskEvent?
        public var date: DateKey?

        public init(
            projectId: String? = nil,
            sectionId: String? = nil,
            labelIds: [String] = [],
            location: TaskLocation? = nil,
            event: TaskEvent? = nil,
            date: DateKey? = nil
        ) {
            self.projectId = projectId
            self.sectionId = sectionId
            self.labelIds = labelIds
            self.location = location
            self.event = event
            self.date = date
        }
    }

    /// Values set with the chips rather than typed.
    public struct Picked: Hashable, Sendable {
        public var due: Due?
        public var priority: Priority?
        public var projectId: String?
        public var sectionId: String?
        public var labelIds: [String]
        public var reminders: [Reminder]
        /// Set by the repeat chip. A typed repeat wins.
        public var recurrence: Recurrence? = nil
        /// Picked with its chip, or from a place screen. A typed `@place` wins.
        public var location: TaskLocation? = nil
        /// Picked with its chip, or from an event screen. It stands in for the date and the repeat.
        public var event: TaskEvent? = nil
    }

    /// What a parse reads: the clock and the names of the space the sheet opened on.
    public struct Context: Sendable {
        public let now: Date
        public let projects: [Project]
        public let sections: [ProjectSection]
        public let labels: [Label]
        public let zone: TimeZone

        public init(now: Date, projects: [Project], sections: [ProjectSection] = [], labels: [Label], zone: TimeZone) {
            self.now = now
            self.projects = projects
            self.sections = sections
            self.labels = labels
            self.zone = zone
        }
    }

    public let defaults: Defaults
    public private(set) var text = ""
    public var picked: Picked

    public init(defaults: Defaults) {
        self.defaults = defaults
        picked = Self.initialPicked(defaults)
    }

    private static func initialPicked(_ defaults: Defaults) -> Picked {
        Picked(
            due: defaults.date.map { Due(date: $0, time: nil) },
            priority: nil,
            projectId: defaults.projectId,
            sectionId: defaults.sectionId,
            labelIds: defaults.labelIds,
            reminders: [],
            location: defaults.location,
            event: defaults.event
        )
    }

    /// Quick add from a saved place's screen starts at that place rather than with it as a label.
    public mutating func startAtPlace(_ labels: [Label]) {
        let applied = Triggers.applyPickedLabels(labels, picked.labelIds, picked.location)
        guard let place = applied.location else { return }
        picked.location = place
        picked.labelIds = picked.labelIds.filter { applied.labelIds.contains($0) }
    }

    public func parse(_ context: Context) -> QuickAdd.Parsed {
        parse(now: context.now, projects: context.projects, sections: context.sections, labels: context.labels, in: context.zone)
    }

    /// A pick wins over every typed copy of its phrase.
    public mutating func clearTokens(_ kind: QuickAdd.TokenKind, _ context: Context) {
        clearTokens(kind, now: context.now, projects: context.projects, sections: context.sections, labels: context.labels, in: context.zone)
    }

    public mutating func pick(priority: Priority, _ context: Context) {
        clearTokens(.priority, context)
        picked.priority = priority
    }

    public mutating func pick(due: Due?, _ context: Context) {
        clearTokens(.due, context)
        picked.due = due
    }

    /// A repeat picked here replaces a typed one, and moves the date when the repeat starts on another day.
    public mutating func pick(recurrence: Recurrence?, start: Due?, due: Due?, _ context: Context) {
        clearTokens(.recurrence, context)
        if start != due { pick(due: start, context) }
        picked.recurrence = recurrence
    }

    /// A picked place wins over a typed `@place`.
    public mutating func pick(location: TaskLocation?, _ context: Context) {
        clearTokens(.place, context)
        picked.location = location
    }

    public mutating func pick(projectId: String?, sectionId: String?, _ context: Context) {
        clearTokens(.section, context)
        clearTokens(.project, context)
        picked.projectId = projectId
        picked.sectionId = sectionId
    }

    /// Unchecking a typed label removes its `@name`, so the picker's list is what saves.
    public mutating func pick(labelIds: [String], _ parsed: QuickAdd.Parsed, _ context: Context) {
        let dropped = parsed.tokens.filter { token in
            token.kind == .label && !labelIds.contains { id in
                context.labels.first { $0.id == id }.map { "@\($0.name)".lowercased() == token.text.lowercased() } ?? false
            }
        }
        removeTokens(dropped)
        // A label the text still types stays the text's, so deleting its `@name` later drops it.
        let kept = picked.labelIds
        picked.labelIds = labelIds.filter { !parsed.labelIds.contains($0) || kept.contains($0) }
    }

    public mutating func setText(_ value: String) {
        text = value
    }

    public func parse(
        now: Date,
        projects: [Project],
        sections: [ProjectSection] = [],
        labels: [Label],
        in zone: TimeZone
    ) -> QuickAdd.Parsed {
        QuickAdd.parse(
            text,
            QuickAdd.Options(
                now: now,
                projects: projects,
                sections: sections,
                labels: labels,
                projectId: picked.projectId,
                due: picked.due
            ),
            in: zone
        )
    }

    /// A manual pick replaces whatever the text said for that attribute. The parser shows only the last copy of a
    /// repeated phrase, so each cut reparses until no copy is left to take over from the pick.
    public mutating func clearTokens(
        _ kind: QuickAdd.TokenKind,
        now: Date,
        projects: [Project],
        sections: [ProjectSection] = [],
        labels: [Label],
        in zone: TimeZone
    ) {
        while let token = parse(now: now, projects: projects, sections: sections, labels: labels, in: zone).tokens
            .first(where: { $0.kind == kind }) {
            removeTokens([token])
        }
    }

    /// Cuts each token's phrase from the text, as unchecking a typed label in the labels picker does.
    public mutating func removeTokens(_ tokens: [QuickAdd.Token]) {
        guard !tokens.isEmpty else { return }
        var units = Array(text.utf16)
        for token in tokens.sorted(by: { $0.start > $1.start }) {
            units.removeSubrange(token.start..<token.end)
        }
        text = Self.runsOfWhitespace.replace(Self.string(units[...])) { _ in " " }
    }

    /// The task to save, or nil while the title is empty. An event stands in for the date and the repeat, as in
    /// task details.
    /// Nil while the title is empty, unless `untitled`: expanding into details saves even an untitled draft. A draft
    /// holding only `images` saves too, named for them, so a snapped photo is one tap from a task.
    public func resolve(_ parsed: QuickAdd.Parsed, untitled: Bool = false, images: Int = 0) -> NewTask? {
        guard untitled || images > 0 || !parsed.title.isEmpty else { return nil }
        let resolved = resolved(parsed)
        var task = NewTask(
            title: parsed.title.isEmpty && !untitled ? Self.imagesTitle(images) : parsed.title,
            projectId: resolved.projectId,
            sectionId: resolved.sectionId,
            labelIds: resolved.labelIds,
            due: picked.event == nil ? resolved.due : nil,
            recurrence: picked.event == nil ? parsed.recurrence ?? picked.recurrence : nil,
            priority: resolved.priority,
            reminders: parsed.reminders + picked.reminders
        )
        task.location = parsed.location ?? picked.location
        task.event = picked.event
        return task
    }

    public static func imagesTitle(_ count: Int) -> String {
        count == 1 ? "Photo" : "\(count) photos"
    }

    /// The values the chips show: the text's when it has one, else the pick's. A typed project other than the picked
    /// one leaves the picked section behind.
    public func resolved(
        _ parsed: QuickAdd.Parsed
    ) -> (due: Due?, priority: Priority, projectId: String?, sectionId: String?, labelIds: [String]) {
        var labelIds = picked.labelIds
        for id in parsed.labelIds where !labelIds.contains(id) { labelIds.append(id) }
        let projectId = parsed.projectId ?? picked.projectId
        return (
            parsed.due ?? picked.due,
            parsed.priority ?? picked.priority ?? .default,
            projectId,
            parsed.sectionId ?? (projectId == picked.projectId ? picked.sectionId : nil),
            labelIds
        )
    }

    /// Starts the next task: an empty field with the sheet's defaults.
    public mutating func reset() {
        text = ""
        picked = Self.initialPicked(defaults)
    }

    /// Replaces a `#`, `/`, or `@` fragment from `start` to `end` with the picked name and a space, and returns the new text
    /// with the caret after the space.
    public static func insertingName(
        _ name: String,
        sigil: String,
        into text: String,
        from start: Int,
        to end: Int
    ) -> (text: String, caret: Int) {
        let units = Array(text.utf16)
        let inserted = "\(sigil)\(name) "
        let tail = leadingWhitespace.replace(string(units[min(end, units.count)...])) { _ in "" }
        return (string(units[..<start]) + inserted + tail, start + inserted.utf16.count)
    }

    /// The label a `@name` token names, matched like the web's chip, ignoring case.
    public static func labelName(_ token: QuickAdd.Token, _ labels: [Label]) -> String? {
        labels.first { "@\($0.name)".lowercased() == token.text.lowercased() }?.name
    }

    /// The date menu's presets: `Today`, `Tomorrow`, and `Next week`, the coming Monday.
    public static func datePresets(_ today: DateKey) -> [(label: String, date: DateKey)] {
        let toMonday = (8 - Dates.weekdayOf(today)) % 7
        return [
            ("Today", today),
            ("Tomorrow", Dates.addDays(today, 1)),
            ("Next week", Dates.addDays(today, toMonday == 0 ? 7 : toMonday)),
        ]
    }

    private static let runsOfWhitespace = JSRegex(#"\s{2,}"#)
    private static let leadingWhitespace = JSRegex(#"^\s+"#)

    private static func string(_ units: ArraySlice<UInt16>) -> String { String(decoding: units, as: UTF16.self) }
}
