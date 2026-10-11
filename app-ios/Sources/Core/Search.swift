import Foundation

/// Search over tasks, projects, and labels, from `shared/search.ts`. Offsets in a `Highlight` count UTF-16 code units,
/// as on the web.
public enum Search {
    /// One matched text and the half-open spans to highlight in it.
    public struct Highlight: Hashable, Codable, Sendable {
        public var text: String
        public var ranges: [Range<Int>]

        public init(text: String, ranges: [Range<Int>]) {
            self.text = text
            self.ranges = ranges
        }
    }

    /// Every searchable text on a task, in the order fields are scored.
    public enum TaskField: String, Codable, CodingKeyRepresentable, CaseIterable, Sendable {
        case title, project, labels, notes

        /// How much a match in the field counts.
        var weight: Int {
            switch self {
            case .title: 4
            case .project, .labels: 2
            case .notes: 1
            }
        }

        /// A list, so that multi-valued fields such as labels fit the same shape.
        func values(_ task: TaskItem, _ context: Context) -> [String] {
            switch self {
            case .title: [task.title]
            case .project: task.projectId.flatMap { context.projects[$0] }.map { [$0.name] } ?? []
            case .labels: task.labelIds.compactMap { context.labels[$0]?.name }
            case .notes: [task.notes]
            }
        }
    }

    public struct TaskHit: Hashable, Codable, Sendable {
        public var task: TaskItem
        public var score: Int
        public var matches: [TaskField: [Highlight]]
    }

    /// A project or label whose name matched.
    public struct NameHit<Item: Hashable & Codable & Sendable>: Hashable, Codable, Sendable {
        public var item: Item
        public var score: Int
        public var name: Highlight
    }

    public struct Results: Hashable, Codable, Sendable {
        public var projects: [NameHit<Project>] = []
        public var labels: [NameHit<Label>] = []
        public var open: [TaskHit] = []
        public var completed: [TaskHit] = []
    }

    struct Context {
        let projects: [String: Project]
        let labels: [String: Label]
    }

    /// Lowercased with accents stripped. `map` points each folded unit back to its original offset, and is nil when
    /// they line up.
    struct Folded {
        let text: [UInt16]
        let map: [Int]?
    }

    /// Folds one UTF-16 unit at a time, like the web, so offsets map back exactly.
    static func fold(_ text: String) -> Folded {
        let units = Array(text.utf16)
        if units.allSatisfy({ $0 < 0x80 }) {
            return Folded(text: units.map { (0x41...0x5A).contains($0) ? $0 + 0x20 : $0 }, map: nil)
        }
        var out: [UInt16] = []
        var map: [Int] = []
        for (i, unit) in units.enumerated() {
            var folded = [unit]
            if let scalar = Unicode.Scalar(unit) {
                let base = String(scalar).decomposedStringWithCanonicalMapping.unicodeScalars.filter { !UTF16Text.isMark($0) }
                folded = Array(String(String.UnicodeScalarView(base)).lowercased().utf16)
            }
            out += folded
            map += repeatElement(i, count: folded.count)
        }
        return Folded(text: out, map: map)
    }

    static func isWordChar(_ unit: UInt16) -> Bool {
        Unicode.Scalar(unit).map(UTF16Text.isLetterOrNumber) ?? false
    }

    /// How well one term matches one text: 3 at the start of the text, 2 at the start of a word, 1 inside a word, 0 not
    /// at all, plus every occurrence to highlight. A one-character term only matches at the start of a word, so typing
    /// a single letter does not light up every task.
    static func matchTerm(_ value: Folded, _ term: [UInt16]) -> (quality: Int, ranges: [Range<Int>]) {
        var quality = 0
        var ranges: [Range<Int>] = []
        var next = UTF16Text.indexOf(value.text, term)
        while let at = next {
            next = UTF16Text.indexOf(value.text, term, from: at + term.count)
            let q = at == 0 ? 3 : isWordChar(value.text[at - 1]) ? 1 : 2
            if q == 1, term.count == 1 { continue }
            quality = max(quality, q)
            let end = at + term.count
            ranges.append(value.map.map { $0[at]..<($0[end - 1] + 1) } ?? at..<end)
        }
        return (quality, ranges)
    }

    static func mergeRanges(_ ranges: [Range<Int>]) -> [Range<Int>] {
        var out: [Range<Int>] = []
        for range in ranges.stableSorted(by: { a, b in a.lowerBound == b.lowerBound ? nil : a.lowerBound < b.lowerBound }) {
            if let last = out.last, range.lowerBound <= last.upperBound {
                out[out.count - 1] = last.lowerBound..<max(last.upperBound, range.upperBound)
            } else {
                out.append(range)
            }
        }
        return out
    }

    static func terms(_ query: String) -> [[UInt16]] {
        UTF16Text.words(fold(UTF16Text.trim(query)).text).filter { !$0.isEmpty }.map(Array.init)
    }

    /// Splits a query into folded terms. Every term must match somewhere for a result to count.
    public static func searchTerms(_ query: String) -> [String] { terms(query).map(UTF16Text.string) }

    /// Scores texts that share a weight: each term counts its best match, and every match is highlighted.
    static func scoreTexts(_ texts: [String], _ terms: [[UInt16]]) -> (best: [Int], highlights: [Highlight]) {
        let folded = texts.map(fold)
        var ranges = texts.map { _ in [Range<Int>]() }
        let best = terms.map { term in
            var quality = 0
            for (i, value) in folded.enumerated() {
                let match = matchTerm(value, term)
                quality = max(quality, match.quality)
                ranges[i] += match.ranges
            }
            return quality
        }
        let highlights = zip(texts, ranges).compactMap { text, ranges in
            ranges.isEmpty ? nil : Highlight(text: text, ranges: mergeRanges(ranges))
        }
        return (best, highlights)
    }

    static func scoreTask(_ task: TaskItem, _ terms: [[UInt16]], _ context: Context) -> TaskHit? {
        var best = terms.map { _ in 0 }
        var matches: [TaskField: [Highlight]] = [:]
        for field in TaskField.allCases {
            let scored = scoreTexts(field.values(task, context), terms)
            for (i, quality) in scored.best.enumerated() { best[i] = max(best[i], quality * field.weight) }
            if !scored.highlights.isEmpty { matches[field] = scored.highlights }
        }
        if best.contains(0) { return nil }
        return TaskHit(task: task, score: best.reduce(0, +), matches: matches)
    }

    /// Best score first, then alphabetical.
    static func searchNames<T: NamedItem & Hashable & Codable & Sendable>(_ items: [T], _ terms: [[UInt16]]) -> [NameHit<T>] {
        items
            .compactMap { item -> NameHit<T>? in
                let (best, highlights) = scoreTexts([item.name], terms)
                if best.contains(0) { return nil }
                return NameHit(item: item, score: best.reduce(0, +), name: highlights[0])
            }
            .stableSorted { a, b in
                if a.score != b.score { return a.score > b.score }
                let order = UTF16Text.compareBase(a.item.name, b.item.name)
                return order == .orderedSame ? nil : order == .orderedAscending
            }
    }

    /// Matches tasks, projects, and labels against every term of the query, case- and accent-insensitively. A title
    /// match outweighs a project or label match, which outweighs a notes match, and a match at the start of a word
    /// outweighs one inside a word. Open tasks break ties by priority, then newest first. Completed tasks come back
    /// separately, most recently completed first on a tie.
    public static func search(_ query: String, _ tasks: [TaskItem], projects: [Project], labels: [Label]) -> Results {
        let terms = terms(query)
        if terms.isEmpty { return Results() }
        let context = Context(
            projects: Dictionary(projects.map { ($0.id, $0) }, uniquingKeysWith: { $1 }),
            labels: Dictionary(labels.map { ($0.id, $0) }, uniquingKeysWith: { $1 })
        )
        let hits = tasks.compactMap { scoreTask($0, terms, context) }
        return Results(
            projects: searchNames(projects, terms),
            labels: searchNames(labels, terms),
            open: hits.filter { $0.task.completedAt == nil }.stableSorted { a, b in
                if a.score != b.score { return a.score > b.score }
                if a.task.priority != b.task.priority { return a.task.priority < b.task.priority }
                return a.task.createdAt == b.task.createdAt ? nil : a.task.createdAt > b.task.createdAt
            },
            completed: hits.filter { $0.task.completedAt != nil }.stableSorted { a, b in
                if a.score != b.score { return a.score > b.score }
                return a.task.completedAt == b.task.completedAt ? nil : a.task.completedAt! > b.task.completedAt!
            }
        )
    }

    /// Cuts a long text down to a window that starts a little before its first highlight.
    public static func excerpt(_ highlight: Highlight, lead: Int = 24) -> Highlight {
        let first = highlight.ranges.first?.lowerBound ?? 0
        if first <= lead { return highlight }
        let units = Array(highlight.text.utf16)
        let space = units[..<min(first - lead + 1, units.count)].lastIndex(of: 0x20)
        let start = min(space.map { $0 + 1 } ?? first - lead, units.count)
        return Highlight(
            text: "…" + UTF16Text.string(units[start...]),
            ranges: highlight.ranges.map { ($0.lowerBound - start + 1)..<($0.upperBound - start + 1) }
        )
    }
}
