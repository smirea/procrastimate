# iOS Core parsers and text helpers review

Scope (app-ios/Sources/Core): QuickAdd.swift 766, QuickAddPattern.swift 123, QuickAddDraft.swift 190, Ramble.swift 340, RambleGrammar.swift 653, RambleRegex.swift 188, RambleStructure.swift 153, Dates.swift 238, Format.swift 194, Search.swift 191, SearchSections.swift 43, NameSearch.swift 161, Todoist.swift 441, CSV.swift 47, Markdown.swift 66, Links.swift 82, UTF16Text.swift 74, LabelColors.swift 59, Dictation.swift 15 (4,024 lines). Tests: VectorTests.swift 767, QuickAddTests 15, QuickAddDraftTests 105, RambleStructureTests 98, DictationTests 36, LabelColorsTests 31, LabelColorSuggestionTests 73, SearchImportVectors 67.
Commit: ad9437e
Method: Read every file in the slice in full, plus the TS originals where parity mattered (quick-add.ts `namedRule`/`parseQuickAdd`/guards, ramble.ts `rewrite`/`normalize`/`nameKey`/`cleanTitle`/build, search.ts `fold`, zoned-time.ts, csv.ts, label-colors.ts, markdown.ts). Ran `swift test` in app-ios: 122 tests in 23 suites passed, including all 27 vector files. I then ran `swift test --filter VectorTests` a second time by mistake; it changed nothing in the tree. To check my claims I copied `Sources/Core` into a scratch package at /tmp/pm10 and ran probes against it (`@testable import`, debug and `-c release -Xswiftc -enable-testing`): emoji through Ramble and QuickAdd, `Search.fold` timings, Ramble normalize, regex compile, and parse timings. Ran the TS `parseRamble` with `bun -e` for the parity check.

## Verdict

The port is faithful and well tested. The vectors pin almost all behavior, the time zone is always passed in (nothing reads the device zone or `Locale.current`), and the force unwraps all sit on capture groups the regex guarantees. Two things matter most. First, Ramble turns any emoji, or any other character outside the BMP, into U+FFFD, because `JSString.char` makes a Swift `String` out of a single UTF-16 unit. A ramble that starts with an emoji therefore gets a title like `�� call mom`, while the web keeps `😀 call mom`. Second, search folding is about 120x slower for any text that contains even one non-ASCII character. iOS smart punctuation types `’` into most titles, and a search over 5,000 such tasks spends about 0.6 s per keystroke just folding (release build, M-series Mac). The biggest simplification is that three hand-rolled JS-to-ICU regex layers should be one.

## Findings (most important first)

### F1. Ramble corrupts characters outside the BMP into U+FFFD, and emoji-first titles change [bug] [CONFIRMED] [effort: S]

`JSString.char(_:)` (RambleRegex.swift:174-177) returns `ns.substring(with: NSRange(location: index, length: 1))`. When that one unit is half of a surrogate pair, bridging it to a Swift `String` replaces it with U+FFFD, because Swift strings cannot hold a lone surrogate. JavaScript strings can, and concatenation pairs them up again, so the TS never shows the problem. Three code paths copy one unit at a time this way:

- `RambleNormalize.rewrite` (Ramble.swift:235 and 247) builds `mapped.text` one unit at a time, so every emoji in the transcript becomes `FFFD FFFD` in the normalized text. The probe printed `MAPPED ["fffd","fffd","20","63",...]` for `😀 call mom tomorrow`.
- `rambleCapitalize` (RambleRegex.swift:184-188) does `js.char(0).uppercased() + js.slice(1, count)`, which splits the pair. User-visible result: `Ramble.parse("😀 call mom tomorrow")` gives the title `"�� call mom"`. The same input through TS `parseRamble` gives `["😀 call mom"]` (checked with `bun -e`). An emoji in the middle of a title survives, because `RambleTitles.build` slices the original transcript and only the first character goes through `char`.
- `RambleGrammar.sliceOf` (RambleGrammar.swift:386) builds the masked attribute text one unit at a time. This is harmless today, since FFFD is also one unit and the offsets stay aligned.

Apple dictation inserts emoji ("heart emoji"), and the `typed` capture mode (Dictation.swift:13) lets Stefan type them. No ramble vector contains any character outside the BMP (`grep` for 4-byte UTF-8 in ramble.json returns 0), so the vectors cannot catch this.

Remedy: delete `JSString.char`. In `rewrite`, collect the output as `[UInt16]` and decode it once at the end with `String(decoding:as: UTF16.self)`. Pairs then join again, and the offset arrays stay as they are. For `rambleCapitalize`, uppercase the first unit only when it is not a surrogate (`UTF16.isLeadSurrogate`); otherwise return the text unchanged. That is exactly what JS `charAt(0).toUpperCase()` does. In `sliceOf`, also build `[UInt16]`. Offsets and every BMP result stay identical, so the vectors keep passing. Add a vector: a TS test `parseRamble('😀 call mom tomorrow')` recorded into ramble.json.

### F2. `Search.fold` is about 120x slower on any text with one non-ASCII character [efficiency] [CONFIRMED] [effort: S]

Search.swift:28-45 takes the fast path only when every unit of the text is ASCII. Otherwise each unit, ASCII or not, gets its own `String(scalar).decomposedStringWithCanonicalMapping`, a scalar filter, a new `String`, and `.lowercased()`. That means several allocations per character, for every task's title, notes, project, and labels, on every keystroke (`SearchResults.swift:15` calls `Search.search` with the whole store). iOS smart punctuation types `’` for every apostrophe and `—` for `--`, so on iOS this slow path is the normal case, not an edge case.

I measured this in the scratch package with a release build. Folding a 47-character title plus 264 characters of notes for 5,000 tasks takes 5 ms when the text is all ASCII and 608 ms when it contains one `’` and one `—` per sentence. `search.md` quotes 10 ms for 5,000 tasks in Bun, which does not hold on iOS. With a fast path for ASCII units inside the loop, the same non-ASCII run drops to 34 ms:

```swift
for (i, unit) in units.enumerated() {
    if unit < 0x80 {
        out.append((0x41...0x5A).contains(unit) ? unit + 0x20 : unit)
        map.append(i)
        continue
    }
    // existing per-unit NFD + mark strip + lowercase
}
```

Behavior does not change: an ASCII unit's NFD form is itself, it has no marks, and lowercasing it is +0x20 for A-Z. To go further, memoize the non-ASCII per-unit folds in a dictionary local to one `search` call. Either way, `search.md`'s Bun-only timing claim should name the iOS number.

### F3. Three separate JS-to-ICU regex layers [simplification] [CONFIRMED] [effort: M]

- `QuickAdd.Pattern` + `QuickAdd.Found` (QuickAddPattern.swift, 123 lines)
- `RambleRegex` + `RambleRegex.Found` (RambleRegex.swift:5-157, about 150 lines)
- `NameSearch.sigilWord` (NameSearch.swift:44-54), hand-written in ICU syntax because "QuickAdd.Pattern would escape the braces of `\p{L}`"

The `icu()` translators are line-for-line copies. `RambleRegex` adds pass-through for `\p{…}` and `{1,64}`, written as a literal where `Pattern` uses `lookbehindLimit`. `Pattern` adds the `\W/\D/\S/\b`-inside-a-class precondition. The JavaScript `\s` set literal appears three times. The `Found` structs are identical apart from `rest`/`named`. `matches`/`first`/`test`/`replace` are duplicated, and only `RambleRegex.replace` skips overlapping matches, a guard that never fires. `Links.link` borrows `QuickAdd.Pattern`, an odd namespace for a links regex.

Remedy: one `JSRegex` type (say `UTF16Text.Regex`) with RambleRegex's translator (it is the superset) plus Pattern's precondition, and one `Found` with `rest`, `named`, and both subscripts. QuickAdd, Ramble, Links, NameSearch, and QuickAddDraft all use it, and `sigilWord` becomes `JSRegex(#"(?<!\S)([#@])([\p{L}\p{N}_\-]+)(?=[,.;:!?)]*(?:\s|$))"#)`, the TS source as written. Expected result: about 150 fewer lines and one place to fix the next ICU/JS difference. Behavior is preserved: the translators produce the same ICU output for every pattern the other one accepts. Check this by running the vectors, which cover every pattern in the parser.

### F4. Ramble rebuilds its 26 normalize regexes on every call, and parse runs on every transcript update [efficiency] [CONFIRMED] [effort: S]

`RambleNormalize.normalize` (Ramble.swift:258-339) declares `steps` as a local array, so each call compiles 26 `NSRegularExpression`s. On top of that, the hour-word step compiles `RambleRegex(#"^oh\s+"#)` inside its closure for every match (line 284), and `leadingCue` compiles `RambleRegex(#"^\s+"#)` for every clause (RambleGrammar.swift:475). `RambleDrawer.parseLive` (RambleDrawer.swift:536) runs `Ramble.parse` on every partial transcript, and `RambleStructure.structured` runs it again once per model piece. Release-build measurements: `normalize` takes 1.18 ms per call, and compiling 26 regexes takes 0.59 ms. A full `Ramble.parse` of a two-sentence ramble takes 3.25 ms, so about 20% of it is compile time that the TS never pays, because there `REWRITES` is a module constant (ramble.ts:254). Remedy: make `steps` a `static let`, and hoist the two inline regexes to statics next to the others. No behavior change.

### F5. Wall-clock math, "next Monday", and ordinals are each written two to four times [simplification] [CONFIRMED] [effort: S]

- The time of day of a `Date` in a zone, `Int((t + secondsFromGMT).rounded(.down))` then `% 1440` or `% 86400`, then `toTimeOfDay`, appears four times: `QuickAdd.clock` (QuickAdd.swift:419-423), `Format.completedWhen` (Format.swift:167-169), `Todoist.readTodoistDate` (Todoist.swift:45-48), and `Triggers.wallTime` (Triggers.swift:41-46, outside the slice). Replace all four with `Dates.toTimeOfDay(_ date: Date, in zone:)` next to `Dates.toDateKey`, which already does the same math for the day. That removes about 15 lines and three call-site copies of floor-mod arithmetic.
- The days to the coming Monday appear three times: `QuickAdd.daysToNextMonday` (QuickAdd.swift:287), `QuickAddDraft.datePresets` (QuickAddDraft.swift:178-182), and `Format.postponeOptions`'s `after(1)` (Format.swift:185). `datePresets` should call `QuickAdd.daysToNextMonday`, or better, `Dates.nextMonday(today)`.
- Ordinal suffixes are written twice: `Format.ordinal` (Format.swift:89) and `RambleNormalize.ordinal` (Ramble.swift:209). The Ramble copy gets 111 to 113 wrong (`111st`); it only ever sees 1 to 31, but there is no reason to keep two.
- `QuickAddDraft.string` (QuickAddDraft.swift:189) duplicates `UTF16Text.string`.

Behavior is identical in each case because the formulas are the same.

### F6. Ramble's value types are hand-declared Swift with hand-written Codable and string-typed kinds [simplification] [PLAUSIBLE] [effort: M]

Ramble.swift:1-130 declares `RambleTask`, `RambleSpan`, `RambleToken`, and `RambleDraft`, plus about 55 lines of hand-written `init(from:)`/`encode(to:)`. These exist to write explicit `null`s so the vector JSON matches. `app-ios/AGENTS.md` says "A new type both clients need is a Zod schema with an `id` in `shared/`, not a Swift declaration". In ramble.ts these are plain TS types, so the generator never sees them. As a result, token kinds are untyped strings everywhere on iOS: `RambleToken.kind: String`, `FieldToken.kind: String`, the `structural` tuple kinds `"note"`/`"subtask"`/`"separator"`/`"correction"`/`"end"`, `Ramble.usesCommands`'s string list (RambleStructure.swift:33), and `RambleDrawer.swift:288`, which recovers a `QuickAdd.TokenKind(rawValue:)` from the string. A typo in any of these compiles and silently drops a tint or wrongly skips the model. Remedy: put Zod schemas with ids in ramble.ts, including a `RambleTokenKind` enum (TokenKind plus the five structural kinds), and use the generated types. The hand-written Codable goes away, and kind comparisons become exhaustive switches. Behavior is the same as long as the generator writes nulls as it does for the other `API` types (the `ListDefaultsJSON` comment in VectorTests suggests it does; I did not check the generator).

## Smaller notes

- Dead or no-op code: `_ = covered` (RambleGrammar.swift:621). `RambleNames.key` slices the whole string, `JSString(spaced).slice(0, JSString(spaced).count)`, which does nothing (RambleGrammar.swift:47). `push` runs a regex on one-character strings to test for whitespace (RambleGrammar.swift:599-600) where `UTF16Text.isWhitespace(unit)` exists. `splitClauses` builds `JSString(text)` three times per match.
- There are two "JavaScript string" abstractions: `JSString` (an NSString wrapper, Ramble only) and `UTF16Text` (`[UInt16]`, search and import). Once F1 removes `char`, `JSString` is just `slice` and `count`, and a `[UInt16]` slice helper in `UTF16Text` could replace it.
- Trimming does not match JS in a few places. `LabelColors` (LabelColors.swift:24 and 33), `Markdown` (Markdown.swift:34 and 38), and parts of Ramble trim with Foundation `.whitespacesAndNewlines`, which includes U+0085 and not U+FEFF, while JS `trim()` does the opposite. `UTF16Text.trim` exists for exactly this. A label name with a leading BOM or NEL would hash to a different default color on iOS than on the web. `LabelColors.hintedColor` splits on `CharacterSet.alphanumerics.inverted`, which counts combining marks as alphanumeric, where the TS uses `[^\p{L}\p{N}]+`. Both are edge cases; the fix is the one helper the module already has.
- `Dates.parts` (Dates.swift:31-34) traps with an index out of range on a `DateKey` without two dashes. All the parser paths build valid keys, so this only matters if a malformed synced row reaches `Format`/`Views`. Validate at decode time, not here.
- `Todoist.mergeBackup` does `tasks.firstIndex` per skipped task and `Subtasks.nextSiblingOrder` (O(n)) per subtask. That is O(n·m) on a re-import, a few million comparisons at Stefan's scale. Fine for a one-off import, and it matches the TS.
- `QuickAdd.namedRule` compiles one regex per kind on every keystroke, like the TS. I measured 0.12 ms for 60 names, so it is not worth caching.
- No Date, Calendar, or TimeZone problems found. Every path takes `zone`, `fromDateKey` resolves DST gaps and overlaps like `zonedTime`, and collation is pinned to `en_US`.

## Test coverage observations

- No ramble, search, name-search, or todoist vector contains a character outside the BMP. Quick-add and links each have only a 🎉 case. F1 went unnoticed because of this gap. Each UTF-16-offset module should get one emoji vector, with the emoji at the start, in the middle, and next to a token.
- `QuickAddTests` pins a single ICU-vs-JS case-folding difference (`ſ` in a label name). ICU's wider case folding also reaches the fixed patterns (`ignoreCase` with `[a-z]`, weekday and month words), which nothing tests. The reads guard against it today by looking up names in tables, but nothing pins that.
- No test covers search performance, and the only timing claim (search.md) is measured in Bun. F2 would have shown up in a 5,000-task benchmark with smart quotes.
- RambleStructureTests and QuickAddDraftTests test behavior through public calls with literal expectations, which is good. `nextWeekIsTheComingMonday` pins `datePresets`, which F5 would merge.
