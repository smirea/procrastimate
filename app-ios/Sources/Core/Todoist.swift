import Foundation

/// The Todoist backup reader and merge of `shared/todoist.ts`. The app unzips the backup and passes its files in, so
/// this stays free of `Compression` and builds on Linux.
public enum Todoist {
    public typealias BackupFile = API.BackupFile
    public typealias BackupProject = API.BackupProject
    public typealias BackupSection = API.BackupSection
    public typealias BackupTask = API.BackupTask
    public typealias Backup = API.TodoistBackup
    public typealias Summary = API.ImportSummary
    public typealias Timing = API.Timing

    nonisolated(unsafe) private static let iso =
        /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.asciiOnlyDigits()

    /// A Todoist date string. ISO dates are read here, and anything else goes through the quick add parser, which must
    /// account for all of it.
    public static func readTodoistDate(_ text: String, _ now: Date, in zone: TimeZone) -> Timing? {
        guard let match = text.wholeMatch(of: iso) else {
            let parsed = QuickAdd.parse(text, QuickAdd.Options(now: now), in: zone)
            guard parsed.title.isEmpty, parsed.priority == nil, parsed.reminders.isEmpty, let due = parsed.due else { return nil }
            return Timing(due: due, recurrence: parsed.recurrence)
        }
        let date = "\(match.1)-\(match.2)-\(match.3)"
        guard let hourText = match.4, let minuteText = match.5 else {
            return Timing(due: Due(date: date, time: nil), recurrence: nil)
        }
        let (month, day, hour, minute) = (Int(match.2)!, Int(match.3)!, Int(hourText)!, Int(minuteText)!)
        // Without an offset the web reads only the date, hours, and minutes.
        let second = match.7 == nil ? 0 : match.6.map { Int($0)! } ?? 0
        // JavaScript's `Date` accepts any day up to 31 and lets it overflow into the next month, and 24:00 as midnight.
        guard (1...12).contains(month), (1...31).contains(day), minute < 60, second < 60,
              hour < 24 || (hour == 24 && minute == 0 && second == 0)
        else { return nil }
        let at: Date
        if let offsetText = match.7 {
            guard let offset = offsetSeconds(offsetText) else { return nil }
            let seconds = Double(Dates.days(year: Int(match.1)!, month: month, day: day) * 86400
                + hour * 3600 + minute * 60 + second - offset)
            at = Date(timeIntervalSince1970: seconds)
        } else {
            at = Dates.fromDateKey(date, "\(hourText):\(minuteText)", in: zone)
        }
        let local = Int((at.timeIntervalSince1970 + Double(zone.secondsFromGMT(for: at))).rounded(.down))
        let minutes = ((local % 86400 + 86400) % 86400) / 60
        return Timing(
            due: Due(date: Dates.toDateKey(at, in: zone), time: Dates.toTimeOfDay(hours: minutes / 60, minutes: minutes % 60)),
            recurrence: nil
        )
    }

    /// `Z`, `+02:00`, or `-0530`, or nil past `23:59`, which JavaScript's `Date` rejects.
    private static func offsetSeconds(_ offset: Substring) -> Int? {
        if offset == "Z" { return 0 }
        let digits = offset.dropFirst().filter(\.isNumber)
        let (hours, minutes) = (Int(digits.prefix(2))!, Int(digits.suffix(2))!)
        guard hours < 24, minutes < 60 else { return nil }
        let total = hours * 3600 + minutes * 60
        return offset.first == "-" ? -total : total
    }

    nonisolated(unsafe) private static let fileName = /^(.+?) \[([^\]]+)\]\.csv$/.ignoresCase()

    private static func baseName(_ path: String) -> String {
        String(path.split(separator: "/", omittingEmptySubsequences: false).last ?? "")
    }

    private static func isCSV(_ name: String) -> Bool { name.lowercased().hasSuffix(".csv") }

    /// Todoist writes a task's labels into its content as `@name`, between whitespace or the ends of the text.
    private static func labelSpans(_ scalars: [Unicode.Scalar]) -> [Range<Int>] {
        var spans: [Range<Int>] = []
        var i = 0
        while i < scalars.count {
            defer { i += 1 }
            guard scalars[i] == "@", i == 0 || UTF16Text.isWhitespace(scalars[i - 1]) else { continue }
            var end = i + 1
            while end < scalars.count, UTF16Text.isLetterOrNumber(scalars[end]) || scalars[end] == "_" || scalars[end] == "-" {
                end += 1
            }
            guard end > i + 1, end == scalars.count || UTF16Text.isWhitespace(scalars[end]) else { continue }
            spans.append(i..<end)
            i = end - 1
        }
        return spans
    }

    static func splitLabels(_ content: String) -> (title: String, labels: [String]) {
        let scalars = Array(content.unicodeScalars)
        let spans = labelSpans(scalars)
        if spans.isEmpty { return (content, []) }
        var kept = String.UnicodeScalarView()
        var at = 0
        for span in spans {
            kept.append(contentsOf: scalars[at..<span.lowerBound])
            at = span.upperBound
        }
        kept.append(contentsOf: scalars[at...])
        var collapsed = String.UnicodeScalarView()
        for scalar in kept {
            let blank = scalar == " " || scalar == "\t"
            if blank, collapsed.last == " " { continue }
            collapsed.append(blank ? " " : scalar)
        }
        let title = UTF16Text.trim(String(collapsed))
        // Like a JavaScript `Map` keyed by the lowercased name: the first spelling's position, the last spelling's text.
        var order: [String] = []
        var spelling: [String: String] = [:]
        for span in spans {
            let name = String(String.UnicodeScalarView(scalars[(span.lowerBound + 1)..<span.upperBound]))
            let key = name.lowercased()
            if spelling[key] == nil { order.append(key) }
            spelling[key] = name
        }
        return (title.isEmpty ? content : title, order.map { spelling[$0]! })
    }

    /// JavaScript's `Number(text)` for a trimmed text, where an empty text is 0.
    private static func number(_ text: String) -> Double? {
        if text.isEmpty { return 0 }
        let lower = text.lowercased()
        for (prefix, radix) in [("0x", 16), ("0o", 8), ("0b", 2)] where lower.hasPrefix(prefix) {
            return Int(lower.dropFirst(2), radix: radix).map(Double.init)
        }
        guard text.unicodeScalars.allSatisfy({ "0123456789+-.eE".unicodeScalars.contains($0) }) else {
            return ["Infinity", "+Infinity"].contains(text) ? .infinity : text == "-Infinity" ? -.infinity : nil
        }
        return Double(text)
    }

    /// JavaScript's `parseInt(text, 10)`: the leading integer, or nil when there is none.
    private static func parseInt(_ text: String) -> Int? {
        var scalars = Substring(text)
        var sign = 1
        if let first = scalars.first, first == "+" || first == "-" {
            sign = first == "-" ? -1 : 1
            scalars = scalars.dropFirst()
        }
        let digits = scalars.prefix { $0.isASCII && $0.isNumber }
        return Int(digits).map { sign * $0 }
    }

    /// Todoist's CSV uses the app's scale, so `1` is p1. A blank or unknown value is p4.
    static func readPriority(_ text: String) -> Priority {
        guard let level = number(text), let rounded = Int(exactly: level) else { return .default }
        return Priority(rawValue: rounded) ?? .default
    }

    private struct Draft {
        var task: BackupTask
        var notes: [String]
        var extras: [String]
    }

    private static func readProject(
        _ file: BackupFile,
        _ now: Date,
        _ zone: TimeZone,
        into backup: inout Backup
    ) {
        let base = baseName(file.name)
        let named = base.wholeMatch(of: fileName)
        let name = named.map { String($0.1) } ?? (isCSV(base) ? String(base.dropLast(4)) : base)
        let id = named.map { String($0.2) } ?? name
        let table = CSV.parseCsv(file.text)
        var columns: [String: Int] = [:]
        for (i, column) in (table.first ?? []).enumerated() { columns[UTF16Text.trim(column)] = i }
        guard columns["TYPE"] != nil, columns["CONTENT"] != nil else {
            backup.warnings.append("\(base) is not a Todoist project file, skipped")
            return
        }
        func get(_ row: [String], _ column: String) -> String {
            guard let i = columns[column], i < row.count else { return "" }
            return UTF16Text.trim(row[i])
        }
        var warnings: [String] = []
        func warn(_ message: String) { warnings.append("\(name): \(message)") }
        let projectKey = "todoist:project:\(id)"
        let inbox = name == "Inbox"
        backup.projects.append(BackupProject(sourceKey: projectKey, name: name, inbox: inbox))

        var drafts: [Draft] = []
        var inboxSections: [String] = []
        var sectionKey: String?
        var sectionsSeen: [String: Int] = [:]
        var ancestors: [(indent: Int, content: String, sourceKey: String)] = []
        var seen: [String: Int] = [:]

        func readTask(_ row: [String], _ content: String) -> Draft {
            let parsed = parseInt(get(row, "INDENT")) ?? 0
            let indent = max(1, parsed == 0 ? 1 : parsed)
            while let last = ancestors.last, last.indent >= indent { ancestors.removeLast() }
            let parentKey = ancestors.last?.sourceKey
            let inSection = parentKey == nil ? sectionKey : nil
            let path = (ancestors.map(\.content) + [content]).joined(separator: " › ")
            let occurrence = (seen[path] ?? 0) + 1
            seen[path] = occurrence
            let sourceKey = "todoist:task:\(id):\(path)\(occurrence > 1 ? "#\(occurrence)" : "")"
            ancestors.append((indent, content, sourceKey))

            let (title, labels) = splitLabels(content)
            var extras: [String] = []
            var timing: Timing?
            let dateText = get(row, "DATE")
            let lang = get(row, "DATE_LANG")
            if !dateText.isEmpty {
                timing = lang.isEmpty || lang == "en" ? readTodoistDate(dateText, now, in: zone) : nil
                if timing == nil {
                    extras.append("Todoist date: \(dateText)")
                    warn("could not read the date \"\(dateText)\" on \"\(title)\", kept it in notes")
                }
            }
            let duration = get(row, "DURATION")
            if !duration.isEmpty {
                let unit = get(row, "DURATION_UNIT")
                extras.append("Duration: \(duration) \(unit.isEmpty ? "minute" : unit)\(duration == "1" ? "" : "s")")
            }
            let deadline = get(row, "DEADLINE")
            if !deadline.isEmpty { extras.append("Deadline: \(deadline)") }
            let task = BackupTask(
                sourceKey: sourceKey,
                parentKey: parentKey,
                projectKey: projectKey,
                sectionKey: inSection,
                title: title,
                notes: "",
                labels: labels,
                due: timing?.due,
                recurrence: timing?.recurrence,
                priority: readPriority(get(row, "PRIORITY")),
                reminders: []
            )
            return Draft(task: task, notes: [get(row, "DESCRIPTION")], extras: extras)
        }

        func readReminder(_ row: [String]) -> Reminder? {
            switch get(row, "REMINDER_TYPE") {
            case "relative":
                guard let minutes = number(get(row, "REMINDER_OFFSET")), let whole = Int(exactly: minutes), whole >= 0
                else { return nil }
                return .before(minutes: whole)
            case "absolute":
                let at = readTodoistDate(get(row, "REMINDER_DATE"), now, in: zone)?.due
                guard let at, let time = at.time else { return nil }
                return .at(date: at.date, time: time)
            default:
                return nil
            }
        }

        for row in table.dropFirst() {
            let type = get(row, "TYPE")
            let content = get(row, "CONTENT")
            switch type {
            case "", "meta":
                break
            case "section":
                // A section starts a new outline, so the next task is top level whatever its indent.
                ancestors.removeAll()
                if inbox {
                    inboxSections.append(content)
                    break
                }
                let occurrence = (sectionsSeen[content] ?? 0) + 1
                sectionsSeen[content] = occurrence
                let key = "todoist:section:\(id):\(content)\(occurrence > 1 ? "#\(occurrence)" : "")"
                sectionKey = key
                backup.sections.append(BackupSection(sourceKey: key, projectKey: projectKey, name: content))
            case "task":
                drafts.append(readTask(row, content))
            case "note":
                if drafts.isEmpty { warn("skipped a comment with no task above it") } else { drafts[drafts.count - 1].notes.append(content) }
            case "reminder":
                let reminder = readReminder(row)
                if drafts.isEmpty {
                    warn("skipped a reminder with no task above it")
                } else if let reminder {
                    drafts[drafts.count - 1].task.reminders.append(reminder)
                } else {
                    let text = [get(row, "REMINDER_TYPE"), get(row, "REMINDER_OFFSET"), get(row, "REMINDER_DATE")]
                        .filter { !$0.isEmpty }
                        .joined(separator: " ")
                    drafts[drafts.count - 1].extras.append("Todoist reminder: \(text)")
                    warn("could not read a reminder on \"\(drafts[drafts.count - 1].task.title)\", kept it in notes")
                }
            default:
                warn("skipped a row of unknown type \"\(type)\"")
            }
        }

        if !inboxSections.isEmpty {
            warn("Inbox has no sections, so these were left out: \(inboxSections.joined(separator: ", "))")
        }
        backup.warnings += warnings
        for draft in drafts {
            var task = draft.task
            task.notes = (draft.notes + draft.extras).filter { !$0.isEmpty }.joined(separator: "\n\n")
            backup.tasks.append(task)
        }
    }

    /// Reads every project CSV in a Todoist backup. Other files, such as macOS metadata, are ignored.
    public static func readTodoistBackup(
        _ files: [BackupFile],
        _ now: Date,
        in zone: TimeZone
    ) -> Backup {
        var backup = Backup()
        for file in files {
            let base = baseName(file.name)
            if !isCSV(base) || base.hasPrefix(".") || file.name.contains("__MACOSX/") { continue }
            readProject(file, now, zone, into: &backup)
        }
        return backup
    }

    /// Adds a backup's projects, sections, labels, and tasks to the store's data. A task whose source key is already
    /// stored is skipped, so importing the same backup twice changes nothing, except that a skipped top-level task still
    /// in no section and in its project joins its section, so a backup imported before sections existed gains them. A
    /// project matches by source key, then by name, and Inbox maps to our Inbox. A section matches by source key, then
    /// by name in its project. Labels match by name, ignoring case. A subtask lands as its parent's last subtask, in the
    /// parent's project, so adding rows in source order reproduces Todoist's outline.
    public static func mergeBackup(
        _ data: StoreData,
        _ backup: Backup,
        newId: () -> String,
        now: Int
    ) -> (data: StoreData, summary: Summary) {
        var projects = data.projects
        var sections = data.sections
        var labels = data.labels
        var tasks = data.tasks
        var summary = Summary(warnings: backup.warnings)
        func sameName(_ a: String, _ b: String) -> Bool { UTF16Text.equal(a.lowercased(), b.lowercased()) }

        var projectIds: [String: String?] = [:]
        for source in backup.projects {
            if source.inbox {
                projectIds[source.sourceKey] = .some(nil)
                continue
            }
            let match = projects.firstIndex { $0.sourceKey == source.sourceKey }
                ?? projects.firstIndex { ($0.sourceKey ?? "").isEmpty && sameName($0.name, source.name) }
            if let match {
                projects[match].sourceKey = source.sourceKey
                projectIds[source.sourceKey] = projects[match].id
                continue
            }
            let project = Project(id: newId(), name: source.name, createdAt: now, sourceKey: source.sourceKey)
            projects.append(project)
            projectIds[source.sourceKey] = project.id
            summary.projects += 1
        }

        var sectionIds: [String: String] = [:]
        for source in backup.sections {
            guard let projectId = projectIds[source.projectKey] ?? nil else { continue }
            // Names are unique in a project, so a repeated name in the backup joins the section that already has it.
            let match = sections.firstIndex { $0.sourceKey == source.sourceKey }
                ?? sections.firstIndex { $0.projectId == projectId && sameName($0.name, source.name) }
            if let match {
                if sections[match].sourceKey == nil { sections[match].sourceKey = source.sourceKey }
                sectionIds[source.sourceKey] = sections[match].id
                continue
            }
            let last = StoreRules.sectionsOf(sections, projectId).last
            let section = ProjectSection(
                id: newId(),
                projectId: projectId,
                name: source.name,
                order: last.map { $0.order + 1 } ?? 0,
                createdAt: now,
                sourceKey: source.sourceKey
            )
            sections.append(section)
            sectionIds[source.sourceKey] = section.id
            summary.sections += 1
        }
        func sectionOf(_ source: BackupTask, _ projectId: String?) -> String? {
            guard let id = source.sectionKey.flatMap({ sectionIds[$0] }),
                  sections.first(where: { $0.id == id })?.projectId == projectId else { return nil }
            return id
        }

        func labelId(_ name: String) -> String {
            if let existing = labels.first(where: { sameName($0.name, name) }) { return existing.id }
            let label = Label(id: newId(), name: name, color: LabelColors.defaultLabelColor(name), createdAt: now)
            labels.append(label)
            summary.labels += 1
            return label.id
        }

        var imported: [String: TaskItem] = [:]
        for task in tasks { if let key = task.sourceKey, !key.isEmpty { imported[key] = task } }
        for (i, source) in backup.tasks.enumerated() {
            if let existing = imported[source.sourceKey] {
                let sectionId = existing.parentId == nil ? sectionOf(source, existing.projectId) : nil
                if existing.sectionId == nil, let sectionId, let index = tasks.firstIndex(where: { $0.id == existing.id }) {
                    tasks[index].sectionId = sectionId
                }
                summary.skipped += 1
                continue
            }
            let parent = source.parentKey.flatMap { imported[$0] }
            let projectId = parent.map(\.projectId) ?? (projectIds[source.projectKey] ?? nil)
            let task = TaskItem(
                id: newId(),
                parentId: parent?.id,
                order: parent.map { Subtasks.nextSiblingOrder(tasks, $0.id) } ?? 0,
                title: source.title,
                notes: source.notes,
                projectId: projectId,
                sectionId: parent == nil ? sectionOf(source, projectId) : nil,
                labelIds: source.labels.map(labelId),
                due: source.due,
                recurrence: source.recurrence,
                priority: source.priority,
                reminders: source.reminders,
                // Views order equal priorities by creation, so each task is a millisecond apart to keep Todoist's order.
                createdAt: now + i,
                sourceKey: source.sourceKey
            )
            tasks.append(task)
            imported[source.sourceKey] = task
            summary.tasks += 1
        }
        var merged = data
        merged.tasks = tasks
        merged.projects = projects
        merged.sections = sections
        merged.labels = labels
        return (merged, summary)
    }
}
