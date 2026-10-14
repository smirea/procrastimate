import Foundation

public protocol NamedItem {
    var id: String { get }
    var name: String { get }
}

extension Project: NamedItem {}
extension Label: NamedItem {}

/// The `#` and `@` suggestion rules of `shared/name-search.ts`. Offsets count UTF-16 code units, as on the web.
public enum NameSearch {
    public typealias Sigil = API.Sigil
    public typealias Fragment = API.SigilFragment

    public enum Suggestion<Item: NamedItem & Hashable & Sendable>: Hashable, Sendable {
        case existing(Item)
        case create(name: String)
    }

    private static let closing = Set(",.;:!?)".utf16)

    /// A sigil starts a fragment at the start of the text or after whitespace, so `a@b.com` and `Issue#12` never do.
    /// The query may contain spaces only while it still prefixes a name, so multi-word names stay searchable. Trailing
    /// sentence punctuation ends it, as it ends a parsed name, so `@calls,` never offers to create `calls,`.
    public static func sigilFragment(_ value: String, _ caret: Int, _ sigil: Sigil, _ items: [some NamedItem]) -> Fragment? {
        let units = Array(value.utf16)
        let caret = min(max(caret, 0), units.count)
        guard let start = units[..<caret].lastIndex(of: sigil.rawValue.utf16.first!) else { return nil }
        if start > 0, !UTF16Text.isWhitespace(units[start - 1]) { return nil }
        let query = units[(start + 1)..<caret]
        if let last = query.last, closing.contains(last) { return nil }
        if query.contains(where: UTF16Text.isWhitespace) {
            let lower = Array(UTF16Text.string(query).lowercased().utf16)
            if !items.contains(where: { UTF16Text.hasPrefix(Array($0.name.lowercased().utf16), lower) }) { return nil }
        }
        let end = units[caret...].firstIndex(where: UTF16Text.isWhitespace) ?? units.count
        return Fragment(start: start, end: end, query: UTF16Text.string(query))
    }

    public typealias UnknownName = API.UnknownName

    /// `SIGIL_WORD` from `name-search.ts`, written for ICU: `\s` is JavaScript's whitespace set and `$` is the end of
    /// the input. `QuickAdd.Pattern` would escape the braces of `\p{L}` inside a class, so this is ICU syntax directly.
    private static let sigilWord: NSRegularExpression = {
        let space = #"\t\n\u000B\f\r \u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF"#
        let source = #"(?<![^\#(space)])([#@])([\p{L}\p{N}_\-]+)(?=[,.;:!?)]*(?:[\#(space)]|\z))"#
        do {
            return try NSRegularExpression(pattern: source)
        } catch {
            preconditionFailure("Invalid pattern \(source): \(error)")
        }
    }()

    /// Every `#name` and `@name` that quick add could offer to create: a sigil at the start of the text or after
    /// whitespace, then a word of letters, digits, `_`, or `-` that ends at whitespace or the end, after any sentence
    /// punctuation, so `@calls,` offers `calls` and `@site.com` offers nothing. Text the parser already claimed is
    /// skipped, so `#Side Project` never offers `#Side`, and so is a name that exists ignoring case, including one kept
    /// as text. Each name is offered once, at its first mention.
    public static func unknownNames(
        _ value: String,
        _ tokens: [QuickAdd.Token],
        _ projects: [some NamedItem],
        _ labels: [some NamedItem]
    ) -> [UnknownName] {
        let ns = NSString(string: value)
        var found: [UnknownName] = []
        var seen = Set<String>()
        for match in sigilWord.matches(in: value, range: NSRange(location: 0, length: ns.length)) {
            let sigil: Sigil = ns.substring(with: match.range(at: 1)) == "#" ? .project : .label
            let nameRange = match.range(at: 2)
            let name = ns.substring(with: nameRange)
            let start = match.range.location
            if tokens.contains(where: { start >= $0.start && start < $0.end }) { continue }
            let lower = name.lowercased()
            let exists = switch sigil {
            case .project: projects.contains { $0.name.lowercased() == lower }
            case .label: labels.contains { $0.name.lowercased() == lower }
            }
            if exists || !seen.insert(sigil.rawValue + lower).inserted { continue }
            found.append(UnknownName(sigil: sigil, name: name, start: start, end: nameRange.location + nameRange.length))
        }
        return found
    }

    /// When each id last appeared on a newly created task, the store's only record of use.
    public static func lastUsed(_ tasks: [TaskItem], _ idsOf: (TaskItem) -> [String]) -> [String: Int] {
        var used: [String: Int] = [:]
        for task in tasks {
            for id in idsOf(task) where task.createdAt > (used[id] ?? 0) {
                used[id] = task.createdAt
            }
        }
        return used
    }

    public static func projectIdsOf(_ task: TaskItem) -> [String] { task.projectId.map { [$0] } ?? [] }

    public static func labelIdsOf(_ task: TaskItem) -> [String] { task.labelIds }

    /// 0 exact, 1 prefix, 2 word prefix, 3 substring, nil no match.
    static func matchTier(_ name: String, _ query: [UInt16]) -> Int? {
        let n = Array(name.lowercased().utf16)
        if n == query { return 0 }
        if UTF16Text.hasPrefix(n, query) { return 1 }
        if UTF16Text.words(n).contains(where: { UTF16Text.hasPrefix($0, query) }) { return 2 }
        return UTF16Text.contains(n, query) ? 3 : nil
    }

    /// Best match first, then most recently used, then alphabetical. Offers to create the query when no name equals it.
    public static func suggest<T: NamedItem & Hashable & Sendable>(
        _ items: [T],
        _ used: [String: Int],
        _ query: String
    ) -> [Suggestion<T>] {
        let trimmed = UTF16Text.trim(query)
        let q = Array(trimmed.lowercased().utf16)
        let ranked = items
            .compactMap { item in matchTier(item.name, q).map { (item: item, tier: $0) } }
            .stableSorted { a, b in
                if a.tier != b.tier { return a.tier < b.tier }
                let (usedA, usedB) = (used[a.item.id] ?? 0, used[b.item.id] ?? 0)
                if usedA != usedB { return usedA > usedB }
                let order = UTF16Text.compareBase(a.item.name, b.item.name)
                return order == .orderedSame ? nil : order == .orderedAscending
            }
        var suggestions = ranked.map { Suggestion.existing($0.item) }
        if !q.isEmpty, ranked.first?.tier != 0 { suggestions.append(.create(name: trimmed)) }
        return suggestions
    }
}

extension NameSearch.Suggestion: Codable where Item: Codable {
    private enum CodingKeys: String, CodingKey { case kind, item, name }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        switch try c.decode(String.self, forKey: .kind) {
        case "existing": self = .existing(try c.decode(Item.self, forKey: .item))
        case "create": self = .create(name: try c.decode(String.self, forKey: .name))
        case let kind:
            throw DecodingError.dataCorruptedError(forKey: .kind, in: c, debugDescription: "Unknown suggestion kind \(kind)")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case let .existing(item):
            try c.encode("existing", forKey: .kind)
            try c.encode(item, forKey: .item)
        case let .create(name):
            try c.encode("create", forKey: .kind)
            try c.encode(name, forKey: .name)
        }
    }
}
