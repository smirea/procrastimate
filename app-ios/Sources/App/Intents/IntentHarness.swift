import AppIntents
import Core

/// DEBUG-only. XCUITests set `PROCRASTIMATE_INTENTS` to a script of lines, and each line runs that intent's `perform()`.
/// The simulator in CI has no Siri service, so this is how the test drives the intents. Release builds omit it.
///
/// One command per line. The first word is the verb:
/// `add <quick add text>`, `complete <title>`, `reopen <title>`, `open inbox|today|upcoming`,
/// `project <name>`, `task <title>`, `search <query>`, `today`, `overdue`, and `ramble`, which opens quick add
/// listening to `PROCRASTIMATE_RAMBLE_SCRIPT`.
/// `addx` takes tab-separated fields: title, project, comma-separated labels, priority (`p1`–`p4`), due ISO-8601, reminder ISO-8601.
enum IntentHarness {
    @MainActor
    static func run() async {
        #if DEBUG
        guard let script = ProcessInfo.processInfo.environment["PROCRASTIMATE_INTENTS"] else { return }
        for line in script.split(separator: "\n", omittingEmptySubsequences: true) {
            await runLine(String(line))
        }
        #endif
    }

    #if DEBUG
    @MainActor
    private static func runLine(_ line: String) async {
        let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let split = trimmed.firstIndex(where: { $0 == " " || $0 == "\t" }) else {
            await command(trimmed, "")
            return
        }
        let verb = String(trimmed[..<split])
        let rest = String(trimmed[trimmed.index(after: split)...])
        await command(verb, rest)
    }

    @MainActor
    private static func command(_ verb: String, _ rest: String) async {
        switch verb {
        case "add": await add(rest)
        case "addx": await addExplicit(rest)
        case "complete": await complete(rest, reopen: false)
        case "reopen": await complete(rest, reopen: true)
        case "open": await open(rest)
        case "project": await project(rest)
        case "task": await task(rest)
        case "search": await search(rest)
        case "today": await perform(ListTodayIntent())
        case "overdue": await perform(ListOverdueIntent())
        case "ramble": _ = IntentEffects.startRamble()
        default: IntentEffects.note("unknown \(verb)")
        }
    }

    /// `perform()` returns an opaque result, which `try?` cannot wrap, so a failure is recorded and the script continues.
    @MainActor
    private static func perform(_ intent: some AppIntent) async {
        do {
            _ = try await intent.perform()
        } catch {
            IntentEffects.note("failed")
        }
    }

    @MainActor
    private static func add(_ text: String) async {
        let intent = AddTaskIntent()
        intent.title = text
        await perform(intent)
    }

    @MainActor
    private static func addExplicit(_ rest: String) async {
        let fields = rest.split(separator: "\t", omittingEmptySubsequences: false).map(String.init)
        guard let title = fields.first, !title.isEmpty else {
            IntentEffects.note("empty")
            return
        }
        let (snapshot, _) = IntentEffects.snapshot()
        let intent = AddTaskIntent()
        intent.title = title
        if fields.count > 1, !fields[1].isEmpty {
            guard let project = IntentRules.named(snapshot.projects, fields[1], name: \.name) else {
                IntentEffects.note("missing-project \(fields[1])")
                return
            }
            intent.project = ProjectEntity(project)
        }
        if fields.count > 2, !fields[2].isEmpty {
            var labels: [LabelEntity] = []
            for name in fields[2].split(separator: ",").map({ $0.trimmingCharacters(in: .whitespaces) }) where !name.isEmpty {
                guard let label = IntentRules.named(snapshot.labels, name, name: \.name) else {
                    IntentEffects.note("missing-label \(name)")
                    return
                }
                labels.append(LabelEntity(label))
            }
            intent.labels = labels
        }
        if fields.count > 3, !fields[3].isEmpty {
            switch fields[3] {
            case "p1": intent.priority = .p1
            case "p2": intent.priority = .p2
            case "p3": intent.priority = .p3
            case "p4": intent.priority = .p4
            default:
                IntentEffects.note("bad-priority \(fields[3])")
                return
            }
        }
        if fields.count > 4, !fields[4].isEmpty {
            guard let date = iso(fields[4]) else {
                IntentEffects.note("bad-due \(fields[4])")
                return
            }
            intent.due = date
        }
        if fields.count > 5, !fields[5].isEmpty {
            guard let date = iso(fields[5]) else {
                IntentEffects.note("bad-reminder \(fields[5])")
                return
            }
            intent.reminder = date
        }
        await perform(intent)
    }

    @MainActor
    private static func complete(_ title: String, reopen: Bool) async {
        let found = (try? await TaskEntityQuery().entities(matching: title)) ?? []
        guard let entity = found.first else {
            IntentEffects.note("missing \(title)")
            return
        }
        if reopen {
            let intent = ReopenTaskIntent()
            intent.task = entity
            await perform(intent)
        } else {
            let intent = CompleteTaskIntent()
            intent.task = entity
            await perform(intent)
        }
    }

    @MainActor
    private static func open(_ name: String) async {
        let list: TaskListKind? = switch name.lowercased() {
        case "inbox": .inbox
        case "tomorrow": .tomorrow
        case "this week": .thisWeek
        case "no date": .noDate
        case "browse": .browse
        default: nil
        }
        guard let list else {
            IntentEffects.note("unknown \(name)")
            return
        }
        let intent = OpenViewIntent()
        intent.list = list
        await perform(intent)
    }

    @MainActor
    private static func project(_ name: String) async {
        let found = (try? await ProjectEntityQuery().entities(matching: name)) ?? []
        guard let project = found.first else {
            IntentEffects.note("missing-project \(name)")
            return
        }
        let intent = OpenProjectIntent()
        intent.project = project
        await perform(intent)
    }

    @MainActor
    private static func task(_ title: String) async {
        let found = (try? await TaskEntityQuery().entities(matching: title)) ?? []
        guard let entity = found.first else {
            IntentEffects.note("missing \(title)")
            return
        }
        let intent = OpenTaskIntent()
        intent.target = entity
        await perform(intent)
    }

    @MainActor
    private static func search(_ query: String) async {
        let intent = SearchTasksIntent()
        intent.query = query
        await perform(intent)
    }

    private static func iso(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        if let date = formatter.date(from: value) { return date }
        formatter.formatOptions.insert(.withFractionalSeconds)
        return formatter.date(from: value)
    }
    #endif
}
