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
        public var labelId: String?
        public var location: TaskLocation?
        public var event: TaskEvent?
        public var date: DateKey?

        public init(
            projectId: String? = nil,
            sectionId: String? = nil,
            labelId: String? = nil,
            location: TaskLocation? = nil,
            event: TaskEvent? = nil,
            date: DateKey? = nil
        ) {
            self.projectId = projectId
            self.sectionId = sectionId
            self.labelId = labelId
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
            labelIds: defaults.labelId.map { [$0] } ?? [],
            reminders: []
        )
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

    /// The task to save, or nil while the title is empty.
    public func resolve(_ parsed: QuickAdd.Parsed) -> NewTask? {
        guard !parsed.title.isEmpty else { return nil }
        let resolved = resolved(parsed)
        return NewTask(
            title: parsed.title,
            projectId: resolved.projectId,
            sectionId: resolved.sectionId,
            labelIds: resolved.labelIds,
            due: resolved.due,
            recurrence: parsed.recurrence ?? picked.recurrence,
            priority: resolved.priority,
            reminders: parsed.reminders + picked.reminders
        )
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

    private static let runsOfWhitespace = QuickAdd.Pattern(#"\s{2,}"#)
    private static let leadingWhitespace = QuickAdd.Pattern(#"^\s+"#)

    private static func string(_ units: ArraySlice<UInt16>) -> String { String(decoding: units, as: UTF16.self) }
}
