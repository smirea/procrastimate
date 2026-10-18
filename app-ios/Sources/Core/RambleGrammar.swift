import Foundation

struct FieldToken {
    var kind: String
    var start: Int
    var end: Int
}

struct Attributes {
    var tokens: [FieldToken]
    var projectId: String?
    var labelIds: [String]
    var priority: Priority?
    var due: Due?
    var recurrence: Recurrence?
    var reminders: [Reminder]
}

struct NamedPattern {
    var pattern: RambleRegex
    var ids: [String: String]
}

struct LabelPatterns {
    var lead: RambleRegex
    var more: RambleRegex
    var suffix: RambleRegex
    var ids: [String: String]
}

private enum RambleNames {
    static let letters = RambleRegex(#"[^\p{L}\p{N}]+"#)
    static let possessive = RambleRegex(#"(?<=\w) ?'?s$"#)
    static let endsWithProject = RambleRegex(#"\bproject$"#, ignoreCase: true)

    static func escape(_ text: String) -> String {
        var out = ""
        for character in text {
            if ".*+?^${}()|[]\\".contains(character) { out.append("\\") }
            out.append(character)
        }
        return out
    }

    static func key(_ name: String) -> String {
        let spaced = letters.replace(rambleFold(name)) { _ in " " }
        return possessive.replaceFirst(JSString(spaced).slice(0, JSString(spaced).count).trimmingCharacters(in: .whitespaces)) { _ in "" }
    }

    static func pattern(_ names: [String]) -> String {
        let alternatives = names.sorted { $0.utf16.count > $1.utf16.count }.map { name in
            letters.split(name).filter { !$0.isEmpty }.map(escape).joined(separator: #"[^\p{L}\p{N}]*"#)
        }
        return "(?:\(alternatives.joined(separator: "|")))(?:'?s)?"
    }

    static func projects(_ projects: [Project]) -> NamedPattern? {
        guard !projects.isEmpty else { return nil }
        let name = pattern(projects.map(\.name))
        let lead = "(?:(?:add|put|move)\\s+(?:it|this|that)\\s+(?:to|in|into|under)\\s+|(?:in|to|for|under|into)\\s+)"
        var alternatives = [
            "\\b\(lead)?(?:the\\s+|my\\s+|our\\s+)?(?<a>\(name))\\s+project\\b",
            "\\b(?:in\\s+(?:the\\s+)?)?project\\s+(?<b>\(name))(?![\\p{L}\\p{N}])",
        ]
        let named = projects.filter { endsWithProject.test($0.name) }
        if !named.isEmpty {
            alternatives.append(
                "\\b\(lead)(?:the\\s+|my\\s+|our\\s+)?(?<c>\(pattern(named.map(\.name))))(?![\\p{L}\\p{N}])"
            )
        }
        var ids: [String: String] = [:]
        for project in projects { ids[key(project.name)] = project.id }
        return NamedPattern(pattern: RambleRegex(alternatives.joined(separator: "|"), ignoreCase: true), ids: ids)
    }

    static func labels(_ labels: [Label]) -> LabelPatterns? {
        guard !labels.isEmpty else { return nil }
        let name = pattern(labels.map(\.name))
        var ids: [String: String] = [:]
        for label in labels { ids[key(label.name)] = label.id }
        return LabelPatterns(
            lead: RambleRegex("\\b(?:labels?|tag(?:ged)?(?:\\s+it)?(?:\\s+(?:with|as))?)\\s+(?<name>\(name))(?![\\p{L}\\p{N}])", ignoreCase: true),
            more: RambleRegex("^(?:\\s*,\\s*(?:and\\s+)?|\\s+and\\s+)(?<name>\(name))(?![\\p{L}\\p{N}])", ignoreCase: true),
            suffix: RambleRegex("\\b(?:(?:with|and)\\s+)?(?:the\\s+|a\\s+)?(?<name>\(name))\\s+(?:label|tag)\\b", ignoreCase: true),
            ids: ids
        )
    }
}

private enum RambleFields {

    static func read(
        _ text: String,
        base: Int,
        now: Date,
        projects: NamedPattern?,
        labels: LabelPatterns?,
        allowProject: Bool,
        zone: TimeZone
    ) -> Attributes {
        var work = text
        var tokens: [FieldToken] = []
        func claim(_ start: Int, _ end: Int) {
            guard end > start else { return }
            let js = JSString(work)
            work = js.slice(0, start) + String(repeating: " ", count: end - start) + js.slice(end, js.count)
        }
        func add(_ kind: String, _ start: Int, _ end: Int) {
            tokens.append(FieldToken(kind: kind, start: base + start, end: base + end))
        }

        var projectId: String?
        if allowProject, let projects {
            let found = projects.pattern.matches(in: work)
            if let last = found.last {
                let raw = last.named("a") ?? last.named("b") ?? last.named("c") ?? ""
                projectId = projects.ids[RambleNames.key(raw)]
                add("project", last.start, last.end)
            }
            for match in found { claim(match.start, match.end) }
        }

        var labelHits: [(at: Int, id: String)] = []
        if let labels {
            func take(_ match: RambleRegex.Found, _ start: Int, _ end: Int) {
                guard let name = match.named("name"), let id = labels.ids[RambleNames.key(name)] else { return }
                labelHits.append((start, id))
                add("label", start, end)
                claim(start, end)
            }
            let leads = labels.lead.matches(in: work)
            for match in leads {
                var end = match.end
                take(match, match.start, end)
                while let next = labels.more.first(in: JSString(work).slice(end, JSString(work).count)) {
                    take(next, end, end + next.end)
                    end += next.end
                }
            }
            for match in labels.suffix.matches(in: work) { take(match, match.start, match.end) }
        }

        let parsed = QuickAdd.parse(work, QuickAdd.Options(now: now, spoken: true), in: zone)
        for token in parsed.tokens {
            add(token.kind.rawValue, token.start, token.end)
        }
        let ordered = labelHits.sorted { $0.at < $1.at }
        var seen: Set<String> = []
        var labelIds: [String] = []
        for hit in ordered where seen.insert(hit.id).inserted { labelIds.append(hit.id) }
        return Attributes(
            tokens: tokens.sorted { $0.start < $1.start },
            projectId: projectId,
            labelIds: labelIds,
            priority: parsed.priority,
            due: parsed.due,
            recurrence: parsed.recurrence,
            reminders: parsed.reminders
        )
    }
}

private enum RambleTitles {
    static let intent =
        "(?:(?:i|we)\\s+(?:also\\s+|still\\s+|really\\s+|definitely\\s+|probably\\s+)*(?:(?:need|have|want|got|ought)\\s+to|'ve\\s+got\\s+to|gotta|should|must|will|'ll|'d\\s+like\\s+to|would\\s+like\\s+to|am\\s+going\\s+to|'m\\s+going\\s+to)(?:\\s+(?:probably|really|also|still|definitely))?|i'll|we'll|(?:also\\s+)?(?:need|have|got)\\s+to|gotta|don't\\s+forget\\s+to|do\\s+not\\s+forget\\s+to|remember\\s+to|remind\\s+me\\s+to|make\\s+sure\\s+(?:to|i|we)|let's|let\\s+me|please)"
    static let filler =
        "(?:let's\\s+see|let\\s+me\\s+(?:think|see)|hmm+|and|also|then|so|oh|hey|plus|okay|ok|um|uh|er|well|actually|wait|sorry|alright|anyway|maybe|probably|possibly)"
    static let leadingJoiners = RambleRegex(
        "^(?:(?:\(filler)|\(intent))\\b|(?:first|firstly|second|secondly|next|lastly|finally)\\s*,)[\\s,]*",
        ignoreCase: true
    )
    static let trailingJoiners = RambleRegex(#"[\s,]*\b(?:and|also|then|so|please|as well)$"#, ignoreCase: true)
    static let leftoverOnly = RambleRegex(
        #"^(?:make it|set it|it's|it is|it|that's|that is|that|this|which is|do it|is|and|the|for it)$"#,
        ignoreCase: true
    )
    static let beforeDate = RambleRegex(
        #"(?:\b(?:(?:it's|it\s+is|is|are|'s|it)\s+)?due|\bby|\bon|\bat|\bfor|\bstarting|\bbeginning|,?\s*\b(?:it's|it\s+is|which\s+is|that's)|,\s*(?:[\w']+\s+){1,4}(?:is|are))\s*$"#,
        ignoreCase: true
    )
    static let spaces = RambleRegex(#"\s+"#)
    static let spaceBeforePunct = RambleRegex(#" (?=[,;:.!?])"#)
    static let edgePunct = RambleRegex(#"^[\s,;:.!?—–-]+|[\s,;:.!?—–-]+$"#)
    static let thisWeek = RambleRegex(#"^(?:this|next)\s+week\s+(?=(?:i|we)\b)"#, ignoreCase: true)
    static let weveGot = RambleRegex(#"^(?:i|we)'ve\s+got\s+(?:a|an)\s+"#, ignoreCase: true)

    static func clean(_ text: String) -> String {
        var title = spaceBeforePunct.replace(spaces.replace(text) { _ in " " }) { _ in "" }
        while true {
            let previous = title
            title = edgePunct.replace(title) { _ in "" }
            title = thisWeek.replaceFirst(title) { _ in "" }
            title = weveGot.replaceFirst(title) { _ in "" }
            title = leadingJoiners.replaceFirst(title) { _ in "" }
            title = trailingJoiners.replaceFirst(title) { _ in "" }
            if previous == title { break }
        }
        if leftoverOnly.test(title) { return "" }
        return rambleCapitalize(title)
    }

    static func build(
        _ transcript: String,
        _ mapped: Mapped,
        _ pieces: [RambleSpan],
        _ tokens: [FieldToken],
        omit: [RambleSpan] = []
    ) -> String {
        var parts: [String] = []
        let source = JSString(transcript)
        let normalized = JSString(mapped.text)
        for piece in pieces {
            var cursor = piece.start
            var inside: [(start: Int, end: Int, beforeDate: Bool)] = tokens
                .filter { $0.start >= piece.start && $0.end <= piece.end }
                .map { ($0.start, $0.end, ["due", "recurrence", "reminder"].contains($0.kind)) }
            inside += omit.filter { $0.end > piece.start && $0.start < piece.end }.map { ($0.start, $0.end, false) }
            inside.sort { $0.start == $1.start ? $0.end < $1.end : $0.start < $1.start }
            var gaps: [(start: Int, end: Int, beforeDate: Bool)] = []
            for token in inside {
                if token.end <= cursor { continue }
                gaps.append((cursor, max(cursor, token.start), token.beforeDate))
                cursor = max(cursor, token.end)
            }
            gaps.append((cursor, piece.end, false))
            for gap in gaps {
                var end = gap.end
                if gap.beforeDate {
                    while let match = beforeDate.first(in: normalized.slice(gap.start, end)) {
                        let next = gap.start + match.start
                        if next >= end { break }
                        end = next
                    }
                }
                if end <= gap.start { continue }
                parts.append(source.slice(mapped.starts[gap.start], mapped.ends[end]))
            }
        }
        return clean(parts.joined(separator: " "))
    }
}

final class RambleItem {
    var main: [RambleSpan] = []
    var notes: [RambleSpan] = []
    var cues: [RambleSpan] = []
    var subtasks: [RambleItem] = []
    weak var parent: RambleItem?
    init(parent: RambleItem? = nil) { self.parent = parent }

    func detached() -> RambleItem {
        let copy = RambleItem()
        copy.main = main
        copy.notes = notes
        copy.cues = cues
        copy.subtasks = subtasks
        return copy
    }
}

struct RambleGrammar {
    let transcript: String
    let mapped: Mapped
    let now: Date
    let zone: TimeZone
    let projects: NamedPattern?
    let labels: LabelPatterns?
    var structural: [(kind: String, start: Int, end: Int)] = []
    var tasks: [RambleItem] = []
    var current: RambleItem?

    static let verbs: Set<String> = [
        "call", "text", "email", "e-mail", "phone", "ping", "message", "dm", "buy", "get", "pick", "grab", "order",
        "book", "schedule", "reschedule", "pay", "send", "write", "finish", "fix", "clean", "wash", "water", "walk",
        "feed", "renew", "cancel", "return", "mail", "file", "submit", "review", "read", "check", "update", "prepare",
        "prep", "plan", "organize", "set", "make", "take", "bring", "drop", "ask", "tell", "meet", "visit", "go",
        "start", "research", "sort", "print", "sign", "cook", "bake", "install", "replace", "repair", "paint", "move",
        "hang", "vacuum", "mow", "change", "charge", "refill", "follow", "reply", "respond", "contact", "invite",
        "thank", "confirm", "register", "apply", "practice", "study", "learn", "try", "look", "find", "figure", "think",
        "talk", "post", "upload", "download", "record", "publish", "deploy", "test", "draft", "edit", "pack", "unpack",
        "ship", "donate", "sell", "list", "clear", "empty", "take", "put", "collect", "deposit", "transfer", "withdraw",
        "backup", "back", "upgrade", "download", "see", "watch", "listen", "pray", "exercise", "run", "stretch", "shop",
        "wrap", "decorate", "tidy", "declutter", "iron", "fold", "sweep", "mop", "dust", "scrub", "trim", "cut", "shave",
        "floss", "compare", "do", "hire", "rent", "reserve", "drive", "fill", "lock", "turn", "gather", "arrange",
        "assemble", "build", "cook", "fetch", "measure", "prune", "rake", "recycle", "remove", "rsvp", "scan", "shred",
        "sweep", "tune", "wipe", "pay", "notify", "warn", "remember", "apply", "enroll", "sign", "share", "archive",
    ]
    static let particles = RambleRegex(#"\b(?:up|off|out|in|down|over|back|on|away)$"#, ignoreCase: true)
    static let leadFillers = RambleRegex(
        #"^(?:(?:and|then|also|plus|oh|hey|so|um|uh|okay|ok|well|first|maybe|probably|possibly)[\s,]+)*"#,
        ignoreCase: true
    )
    static let intentStart = RambleRegex("^\(RambleTitles.intent)\\b", ignoreCase: true)
    static let dueClause = RambleRegex(#"^(?:the|my|our|this|that)\s+[\w' ]{1,30}?(?:'s|\s+is|\s+are)\s+due\b"#, ignoreCase: true)
    static let word = RambleRegex(#"^[a-z'-]+"#, ignoreCase: true)
    static let verbTail = RambleRegex(#"^\S+\s+\S"#)
    static let clauseSplit = RambleRegex(#"\s*,\s*|\s+(?=(?:and|then|also|plus|oh)\s)"#)
    static let connectorsPattern = RambleRegex(#"^(?:(?:and|then|also|plus|oh|so|maybe|probably)[\s,]+)*"#, ignoreCase: true)
    static let strongConnector = RambleRegex(#"\b(?:then|also|plus|oh)\b"#)
    static let ohAnd = RambleRegex(#"\boh\s+and\b"#)
    static let determiner = RambleRegex(#"^(?:the|a|an|some|my|our|his|her|its|that|this)\b"#, ignoreCase: true)
    static let intentLater = RambleRegex("^(?:\\S+\\s+){1,3}\(RambleTitles.intent)\\b", ignoreCase: true)
    static let abbreviation = RambleRegex(#"\b(?:mr|mrs|ms|dr|st|jr|sr|vs|etc|e\.g|i\.e|approx|no|mt|ft)$"#, ignoreCase: true)
    static let boundary = RambleRegex(
        "(?<separator>\\b(?:\(RambleNormalize.separator))\\b[\\s,:]*)|(?<correction>\\b(?:scratch\\s+that|remove\\s+that|delete\\s+that|never\\s?mind)\\b[.,!]*)|(?<sentence>[.!?]+(?=\\s|$))",
        ignoreCase: true
    )
    static let correctionFollow = RambleRegex(
        "^\\s*(?:[.,;!?]|$|(?:\(RambleNormalize.separator))\\b|i\\b|\(RambleTitles.intent)\\b)",
        ignoreCase: true
    )
    static let toBefore = RambleRegex(#"\bto\s+$"#, ignoreCase: true)
    static let ending = RambleRegex(
        #"(?:^|[\s,.;!?])(?:that's|thats|that\s+is)\s+(?:all|it)(?:\s+for\s+now)?[\s.!?]*$"#,
        ignoreCase: true
    )
    static let leadingPunct = RambleRegex(#"^[\s,.;!?]"#)
    static let noteAtStart = RambleRegex(
        #"^\s*(?:and\s+)?(?:add\s+a\s+note|the\s+notes?\s+(?:is|are|says?)|notes?|details)(?!\s+to\s+self\b)\b[\s:,-]*"#,
        ignoreCase: true
    )
    static let structure = RambleRegex(
        "(?<note>\\b(?:with\\s+(?:a|the)\\s+note(?:\\s+that)?|add\\s+a\\s+note|the\\s+note\\s+is)\\b[\\s:,-]*|(?<=[,;:]\\s*)(?:and\\s+)?(?:notes?|details)(?!\\s+to\\s+self\\b)\\b[\\s:,-]*)|(?<list>\\b(?:with\\s+(?:the\\s+)?|and\\s+)?sub[\\s-]?tasks\\b[\\s:,-]*|[\\s,]*\\b(?:the\\s+steps\\s+are|steps\\s+are|which\\s+means|that\\s+means|the\\s+list\\s+is)\\b[\\s:,-]*|(?<=[a-z])\\s*:\\s+(?=[a-z]))|(?<one>\\b(?:and\\s+|with\\s+)?(?:add\\s+)?(?:a\\s+|another\\s+)?sub[\\s-]?task\\b[\\s:,-]*)",
        ignoreCase: true
    )
    static let listSplit = RambleRegex(#"\s*,\s*(?:and\s+)?|\s+and\s+"#, ignoreCase: true)
    static let cue = RambleRegex(
        #"^(?:(?:and|also|oh)\s+)?(?:remind\s+me(?!\s+to\b)|priority|p[1-4]\b|project|in\s+(?:the\s+|my\s+)?project|labels?|tag(?:ged)?|it'?s\s+due|it\s+is\s+due|due|make\s+it(?:\s+to)?|set\s+it(?:\s+to)?|every|each|add\s+it|put\s+it|move\s+it|(?:for|in|to)\s+(?:the|my)\s)"#,
        ignoreCase: true
    )
    static let letters = RambleRegex(#"[\p{L}\p{N}]"#)
    static let leadingSpace = RambleRegex(#"^\s+"#)
    static let words = RambleRegex(#"\s+"#)
    static let leftTrim = RambleRegex(#"^[\s,;]+"#)

    init(transcript: String, now: Date, projects: [Project], labels: [Label], zone: TimeZone) {
        self.transcript = transcript
        mapped = RambleNormalize.normalize(transcript)
        self.now = now
        self.zone = zone
        self.projects = RambleNames.projects(projects)
        self.labels = RambleNames.labels(labels)
    }

    func span(_ range: RambleSpan) -> String { JSString(mapped.text).slice(range.start, range.end) }

    func blank(_ text: String) -> Bool { !Self.letters.test(text) }

    func firstWord(_ text: String) -> String {
        guard let match = Self.word.first(in: text) else { return "" }
        return rambleFold(match.value)
    }

    func startsWithVerb(_ text: String) -> Bool {
        Self.verbs.contains(firstWord(text)) && Self.verbTail.test(text)
    }

    func startsWithIntent(_ text: String) -> Bool { Self.intentStart.test(text) }

    func taskLike(_ text: String) -> Bool {
        let stripped = Self.leadFillers.replaceFirst(text.trimmingCharacters(in: .whitespacesAndNewlines)) { _ in "" }
        if startsWithVerb(stripped) || startsWithIntent(stripped) { return true }
        return Self.intentLater.test(stripped)
    }

    func attributes(_ text: String, _ base: Int, _ allowProject: Bool) -> Attributes {
        RambleFields.read(text, base: base, now: now, projects: projects, labels: labels, allowProject: allowProject, zone: zone)
    }

    func sliceOf(_ item: RambleItem, _ allowProject: Bool) -> (attributes: Attributes, start: Int) {
        let start = item.main.map(\.start).min() ?? 0
        let end = item.main.map(\.end).max() ?? start
        var masked = [UInt16](repeating: 0x3B, count: max(0, end - start))
        let normalized = JSString(mapped.text)
        for range in item.main {
            for index in range.start..<range.end where index - start < masked.count {
                masked[index - start] = normalized.unit(index)
            }
        }
        return (attributes(String(decoding: masked, as: UTF16.self), start, allowProject), start)
    }

    func titleOf(_ ranges: [RambleSpan], _ allowProject: Bool) -> (title: String, attributes: Attributes) {
        let item = RambleItem()
        item.main = ranges
        let read = sliceOf(item, allowProject)
        return (RambleTitles.build(transcript, mapped, ranges, read.attributes.tokens), read.attributes)
    }

    func splitClauses(_ text: String, _ base: Int) -> [RambleSpan] {
        var clauses: [RambleSpan] = []
        var start = 0
        for match in Self.clauseSplit.matches(in: text) {
            let at = match.start
            let rest = JSString(text).slice(at + match.value.utf16.count, JSString(text).count)
            let connectors = rambleFold(Self.connectorsPattern.first(in: rest)?.value ?? "")
            let next = JSString(rest).slice(JSString(connectors).count, JSString(rest).count)
            let left = Self.leftTrim.replaceFirst(JSString(text).slice(start, at)) { _ in "" }.trimmingCharacters(in: .whitespaces)
            if RambleTitles.clean(left).isEmpty || next.isEmpty { continue }
            let comma = match.value.contains(",")
            let strong = Self.strongConnector.test(connectors)
            let words = Self.words.split(left).count
            let nextWords = Self.words.split(next).filter { !$0.isEmpty }.count
            let split =
                startsWithIntent(next)
                || (Self.dueClause.test(next) && words >= 2)
                || (Self.ohAnd.test(connectors) && !next.isEmpty)
                || (strong && nextWords >= 2 && !Self.determiner.test(next))
                || (startsWithVerb(next) && (comma
                    ? taskLike(left) || strong
                    : strong || (taskLike(left) && words >= 2 && !Self.particles.test(left))))
            if !split { continue }
            clauses.append(RambleSpan(start: base + start, end: base + at))
            start = at
        }
        clauses.append(RambleSpan(start: base + start, end: base + JSString(text).count))
        return clauses
    }

    func findBoundaries(_ text: String) -> [(kind: String, start: Int, end: Int)] {
        var boundaries: [(kind: String, start: Int, end: Int)] = []
        let js = JSString(text)
        for match in Self.boundary.matches(in: text) {
            if match.named("sentence") != nil, Self.abbreviation.test(js.slice(0, match.start)) { continue }
            if match.named("correction") != nil {
                if Self.toBefore.test(js.slice(0, match.start)) || !correctionEnds(js.slice(match.end, js.count)) { continue }
            }
            let kind = match.named("separator") != nil ? "separator" : match.named("correction") != nil ? "correction" : "sentence"
            boundaries.append((kind, match.start, match.end))
        }
        return boundaries
    }

    func correctionEnds(_ rest: String) -> Bool {
        Self.correctionFollow.test(rest) || startsWithVerb(rest.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    func listParts(_ range: RambleSpan) -> [RambleSpan] {
        let text = span(range)
        var parts: [RambleSpan] = []
        var start = range.start
        for match in Self.listSplit.matches(in: text) {
            parts.append(RambleSpan(start: start, end: range.start + match.start))
            start = range.start + match.end
        }
        parts.append(RambleSpan(start: start, end: range.end))
        return parts.filter { !blank(span($0)) }
    }

    mutating func startTask(_ range: RambleSpan?) -> RambleItem {
        let task = RambleItem()
        if let range { task.main.append(range) }
        tasks.append(task)
        current = task
        return task
    }

    func rootOf(_ item: RambleItem?) -> RambleItem? { item?.parent ?? item }

    func attributesOnly(_ range: RambleSpan, _ item: RambleItem) -> Bool {
        titleOf([range], item.parent == nil).title.isEmpty
    }

    func leadingCue(_ range: RambleSpan) -> RambleSpan? {
        let clause = span(range)
        let skip = JSString(clause).count - JSString(Self.leadingSpace.replaceFirst(clause) { _ in "" }).count
        guard let match = Self.cue.first(in: JSString(clause).slice(skip, JSString(clause).count)) else { return nil }
        let start = range.start + skip
        return RambleSpan(start: start, end: start + match.end)
    }

    func shouldAttach(_ range: RambleSpan, _ item: RambleItem) -> Bool {
        let read = titleOf([range], item.parent == nil)
        if read.title.isEmpty { return true }
        return leadingCue(range) != nil && !read.attributes.tokens.isEmpty
    }

    mutating func handleLead(_ range: RambleSpan, _ forceNew: Bool) {
        let clauses = splitClauses(span(range), range.start).filter { !blank(span($0)) }
        for (index, clause) in clauses.enumerated() {
            let attach = current != nil && (index == 0 ? !forceNew && shouldAttach(clause, current!) : attributesOnly(clause, current!))
            if attach, let current {
                current.main.append(clause)
                if let cue = leadingCue(clause) { current.cues.append(cue) }
            } else {
                _ = startTask(clause)
            }
        }
    }

    mutating func handleSentence(_ range: RambleSpan, _ forceNew: Bool) {
        let sentence = span(range)
        if let current, !forceNew, let note = Self.noteAtStart.first(in: sentence) {
            current.cues.append(RambleSpan(start: range.start, end: range.start + note.end))
            current.notes.append(RambleSpan(start: range.start + note.end, end: range.end))
            structural.append((kind: "note", start: range.start, end: range.start + note.end))
            return
        }
        let markers: [(kind: String, start: Int, end: Int)] = Self.structure.matches(in: sentence).map { match in
            let kind = match.named("note") != nil ? "note" : match.named("list") != nil ? "list" : "one"
            return (kind, range.start + match.start, range.start + match.end)
        }
        let leadEnd = markers.first?.start ?? range.end
        if !blank(JSString(mapped.text).slice(range.start, leadEnd)) { handleLead(RambleSpan(start: range.start, end: leadEnd), forceNew) }
        for (index, marker) in markers.enumerated() {
            let nextStart = marker.kind == "note" ? range.end : (markers.dropFirst(index + 1).first?.start ?? range.end)
            let content = RambleSpan(start: marker.end, end: nextStart)
            let cue = RambleSpan(start: marker.start, end: marker.end)
            if marker.kind == "note" {
                guard let target = current else {
                    _ = startTask(RambleSpan(start: marker.start, end: range.end))
                    return
                }
                target.cues.append(cue)
                target.notes.append(content)
                structural.append((kind: "note", start: cue.start, end: cue.end))
                return
            }
            structural.append((kind: "subtask", start: cue.start, end: cue.end))
            guard let root = rootOf(current) else {
                if marker.kind == "one" { startTask(content).cues.append(cue) }
                else { for part in listParts(content) { startTask(part).cues.append(cue) } }
                continue
            }
            root.cues.append(cue)
            if marker.kind == "one" {
                let subtask = RambleItem(parent: root)
                subtask.main.append(content)
                root.subtasks.append(subtask)
                current = subtask
            } else {
                for part in listParts(content) {
                    let subtask = RambleItem(parent: root)
                    subtask.main.append(part)
                    root.subtasks.append(subtask)
                }
                current = root
            }
        }
    }

    mutating func dropCurrent() {
        guard let item = current else { return }
        if let parent = item.parent {
            parent.subtasks.removeAll { $0 === item }
            current = parent
        } else {
            tasks.removeAll { $0 === item }
            current = tasks.last
        }
    }

    func original(_ range: RambleSpan) -> RambleSpan {
        RambleSpan(start: mapped.starts[range.start], end: mapped.ends[range.end])
    }

    mutating func parse() -> RambleDraft {
        var text = mapped.text
        var ended = false
        if let match = Self.ending.first(in: text) {
            let start = match.start + (Self.leadingPunct.test(match.value) ? 1 : 0)
            structural.append((kind: "end", start: start, end: JSString(text).count))
            text = JSString(text).slice(0, start)
            ended = true
        }
        var cursor = 0
        var forceNew = true
        let length = JSString(text).count
        for boundary in findBoundaries(text) + [(kind: "sentence", start: length, end: length)] {
            let part = RambleSpan(start: cursor, end: boundary.start)
            if !blank(span(part)) {
                handleSentence(part, forceNew)
                forceNew = false
            }
            cursor = boundary.end
            if boundary.kind == "separator" {
                structural.append((kind: "separator", start: boundary.start, end: boundary.end))
                forceNew = true
            } else if boundary.kind == "correction" {
                structural.append((kind: "correction", start: boundary.start, end: boundary.end))
                dropCurrent()
                forceNew = true
            }
        }

        var tokens: [RambleToken] = []
        func push(_ kind: String, _ range: RambleSpan) {
            var span = original(range)
            let source = JSString(transcript)
            while span.start < span.end, UTF16Text.isWhitespace(source.unit(span.start)) { span.start += 1 }
            while span.end > span.start, UTF16Text.isWhitespace(source.unit(span.end - 1)) { span.end -= 1 }
            tokens.append(RambleToken(kind: kind, start: span.start, end: span.end, text: source.slice(span.start, span.end)))
        }
        func build(_ item: RambleItem, _ isRoot: Bool) -> RambleTask? {
            let read = item.main.isEmpty ? nil : sliceOf(item, isRoot).attributes
            let title = read.map { RambleTitles.build(transcript, mapped, item.main, $0.tokens, omit: item.cues) } ?? ""
            if title.isEmpty { return nil }
            let subtasks = isRoot ? item.subtasks.compactMap { build($0, false) } : []
            for token in read?.tokens ?? [] { push(token.kind, RambleSpan(start: token.start, end: token.end)) }
            let notes = item.notes
                .map { sourceSlice($0).trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
                .joined(separator: " ")
                .replacingOccurrences(of: #"^[\s:,-]+"#, with: "", options: .regularExpression)
            let ranges = item.main + item.notes + item.cues
            let covered = RambleSpan(start: ranges.map(\.start).min() ?? 0, end: ranges.map(\.end).max() ?? 0)
            var segment = original(covered)
            for subtask in subtasks {
                segment.start = min(segment.start, subtask.segment.start)
                segment.end = max(segment.end, subtask.segment.end)
            }
            return RambleTask(
                segment: segment,
                title: title,
                notes: notes,
                due: read?.due,
                recurrence: read?.recurrence,
                priority: read?.priority,
                reminders: read?.reminders ?? [],
                projectId: isRoot ? read?.projectId : nil,
                labelIds: read?.labelIds ?? [],
                subtasks: subtasks
            )
        }
        var built: [RambleTask] = []
        for task in tasks {
            if let result = build(task, true) { built.append(result) }
            else {
                for subtask in task.subtasks {
                    if let promoted = build(subtask.detached(), true) { built.append(promoted) }
                }
            }
        }
        for marker in structural { push(marker.kind, RambleSpan(start: marker.start, end: marker.end)) }
        tokens.sort { $0.start == $1.start ? $0.end < $1.end : $0.start < $1.start }
        return RambleDraft(tasks: built, tokens: tokens, ended: ended)
    }

    func sourceSlice(_ range: RambleSpan) -> String {
        let span = original(range)
        return JSString(transcript).slice(span.start, span.end)
    }
}
