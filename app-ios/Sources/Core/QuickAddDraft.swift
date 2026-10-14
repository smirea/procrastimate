import Foundation

/// The quick add sheet's state and rules from `app-web/src/lib/components/QuickAdd.svelte`: the typed text, the phrases
/// kept as text, and the values picked with chips. The text wins over a pick for the same attribute, and picking a
/// value removes the phrase that set it. Offsets are UTF-16, like the parser's tokens.
public struct QuickAddDraft: Hashable, Sendable {
    /// What the sheet opened with, from the list it opened in.
    public struct Defaults: Hashable, Sendable {
        public var projectId: String?
        public var labelId: String?
        public var today: Bool

        public init(projectId: String? = nil, labelId: String? = nil, today: Bool = false) {
            self.projectId = projectId
            self.labelId = labelId
            self.today = today
        }
    }

    /// Values set with the chips rather than typed.
    public struct Picked: Hashable, Sendable {
        public var due: Due?
        public var priority: Priority?
        public var projectId: String?
        public var labelIds: [String]
        public var reminders: [Reminder]
    }

    public let defaults: Defaults
    public private(set) var text = ""
    /// Token texts kept as plain title text.
    public private(set) var disabled: [String] = []
    public var picked: Picked
    /// A repeat the ramble grammar set. The text's own repeat wins when it has one.
    public var appliedRecurrence: Recurrence? = nil

    public init(defaults: Defaults, today: DateKey) {
        self.defaults = defaults
        picked = Self.initialPicked(defaults, today)
    }

    private static func initialPicked(_ defaults: Defaults, _ today: DateKey) -> Picked {
        Picked(
            due: defaults.today ? Due(date: today, time: nil) : nil,
            priority: nil,
            projectId: defaults.projectId,
            labelIds: defaults.labelId.map { [$0] } ?? [],
            reminders: []
        )
    }

    /// Clearing the text forgets the phrases kept as text, so the next task parses them again.
    public mutating func setText(_ value: String) {
        text = value
        if value.isEmpty { disabled = [] }
    }

    public func parse(now: Date, projects: [Project], labels: [Label], in zone: TimeZone) -> QuickAdd.Parsed {
        QuickAdd.parse(
            text,
            QuickAdd.Options(now: now, projects: projects, labels: labels, disabled: disabled, due: picked.due),
            in: zone
        )
    }

    public mutating func keepAsText(_ token: QuickAdd.Token) {
        disabled.append(token.text)
    }

    /// A manual pick replaces whatever the text said for that attribute.
    public mutating func clearToken(_ kind: QuickAdd.TokenKind, in parsed: QuickAdd.Parsed) {
        guard let token = parsed.tokens.first(where: { $0.kind == kind }) else { return }
        let units = Array(text.utf16)
        let joined = Self.string(units[..<token.start]) + Self.string(units[token.end...])
        text = Self.runsOfWhitespace.replace(joined) { _ in " " }
    }

    /// The task to save, or nil while the title is empty.
    public func resolve(_ parsed: QuickAdd.Parsed) -> NewTask? {
        guard !parsed.title.isEmpty else { return nil }
        let resolved = resolved(parsed)
        return NewTask(
            title: parsed.title,
            projectId: resolved.projectId,
            labelIds: resolved.labelIds,
            due: resolved.due,
            recurrence: parsed.recurrence ?? appliedRecurrence,
            priority: resolved.priority,
            reminders: parsed.reminders + picked.reminders
        )
    }

    /// The values the chips show: the text's when it has one, else the pick's.
    public func resolved(_ parsed: QuickAdd.Parsed) -> (due: Due?, priority: Priority, projectId: String?, labelIds: [String]) {
        var labelIds = picked.labelIds
        for id in parsed.labelIds where !labelIds.contains(id) { labelIds.append(id) }
        return (
            parsed.due ?? picked.due,
            parsed.priority ?? picked.priority ?? .default,
            parsed.projectId ?? picked.projectId,
            labelIds
        )
    }

    /// Starts the next task: an empty field with the sheet's defaults.
    public mutating func reset(today: DateKey) {
        text = ""
        disabled = []
        picked = Self.initialPicked(defaults, today)
        appliedRecurrence = nil
    }

    /// Replaces the field with a finished ramble. The title goes in the textbox and the metadata into the chips.
    /// List defaults fill only what the speech left empty. Returns false when the grammar found no task.
    @discardableResult
    public mutating func applyRamble(_ ramble: RambleDraft, today: DateKey) -> Bool {
        guard let fill = Ramble.quickAdd(from: ramble) else { return false }
        text = fill.text
        disabled = []
        var labelIds = fill.labelIds
        if let labelId = defaults.labelId, !labelIds.contains(labelId) { labelIds.insert(labelId, at: 0) }
        picked = Picked(
            due: fill.due ?? (defaults.today ? Due(date: today, time: nil) : nil),
            priority: fill.priority,
            projectId: fill.projectId ?? defaults.projectId,
            labelIds: labelIds,
            reminders: fill.reminders
        )
        appliedRecurrence = fill.recurrence
        return true
    }

    /// Replaces a `#` or `@` fragment from `start` to `end` with the picked name and a space, and returns the new text
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
