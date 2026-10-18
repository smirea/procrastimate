# Shared parsers and text review

Scope: `shared/` quick-add.ts (812), quick-add-buttons.ts (62), ramble.ts (984), ramble-fill.ts (40), ramble/protocol.ts (53), dictation.ts (32), format.ts (204), zoned-time.ts (84), markdown.ts (64), links.ts (71), csv.ts (32), name-search.ts (124), search.ts (194). Total 2756 lines. I read every file in full and used the `*.test.ts` beside each as behavior pins. I also read `shared/fixtures/ramble-corpus.ts` (header and seeds) and the callers in `app-web/src/lib` (Search.svelte, SmartInput.svelte, RambleDrawer.svelte, ramble/entries.ts), `server/src` (commands.ts, ramble.ts, memo-tasks.ts), and `shared/todoist.ts`.
Commit: ad9437e
Method: I ran `bun test` on the 12 slice test files (1139 pass). All scratch work lives under `/tmp/thermo01/`:

- `probe.ts`: Ramble token output, odd quick-add dates, and CSV.
- `sweep.ts`: about 380 month/day phrase forms through `parseQuickAdd`.
- `dst.ts`: `zonedTime`/`zonedDateKey` against the process-zone `Date`, in 7 zones (New York, London, Berlin, Lord Howe, Apia, Havana, Kolkata) at DST edges and month ends. 0 mismatches.
- `bench.ts`: 3000 synthetic tasks through `search`, and a 2.4k-char transcript through `parseRamble`, both whole and as 28 streamed partials.
- `csvimp.ts`: a broken CSV through `readTodoistBackup`.
- `proto/` and `search-fast.ts`: two prototype refactors, diffed against the real modules over every recorded vector input and the full Ramble corpus.

The working tree is unchanged.

## Verdict

This slice is in good shape. quick-add.ts is already a precedence-ordered rule table with masking, not ad hoc regex passes. A 1295-line test file and the Swift vectors pin it hard. A tokenizer rewrite would cost a lot and buy little. Ramble does not restate quick add's date grammar: it normalizes speech, then calls `parseQuickAdd`. zoned-time.ts is correct across DST gaps, overlaps, half-hour zones, and midnight transitions.

The two things that matter most:

1. Search's per-keystroke cost is about 10x the figure in `docs/decisions/search.md` as soon as task notes contain a single non-ASCII character. That is likely for Stefan, given Romanian diacritics, `café`, and the like.
2. There are two small silent failures. A quoted CSV field with no closing quote swallows the rest of a Todoist file into one task with no warning. `feb 29` typed outside a leap year stays text instead of meaning the next Feb 29.

## Findings (most important first)

### F1. Search folds every field character by character once any field has an accent: 17-38 ms per keystroke at 3000 tasks [efficiency] [CONFIRMED] [effort: S]

**Where the time goes.** `search.ts:70-80`: `fold` has an ASCII fast path for the whole string. Any other string goes through a per-character loop that calls `normalize('NFD')`, a Unicode regex replace, and `toLowerCase()` on every character, ASCII ones included, and builds the result with string `+=`.

`scoreTask` (`search.ts:138-151`) then folds twice per task on every keystroke:

1. It folds the joined haystack for the prefilter (`fold(values.flat().join('\n'))`).
2. For tasks that pass the prefilter, `scoreTexts` folds each field again.

A single accented character anywhere in a task's notes sends that whole notes string, and the joined haystack, through the slow path. `Search.svelte:41` recomputes `search(query, store.own.tasks, …)` in a `$derived` on every keystroke.

**Measured** (`/tmp/thermo01/bench.ts`): 3000 tasks, 6-word titles, about 250-char notes on two thirds of them.

| Content                                             | `b`     | `bu`    | `buy mi` | `zzz` (no match) |
| --------------------------------------------------- | ------- | ------- | -------- | ---------------- |
| Notes contain `détails`, some titles contain `café` | 38.3 ms | 23.6 ms | 17.3 ms  | 16.6 ms          |
| Same content in pure ASCII                          | 6.7 ms  | 3.1 ms  | 1.6 ms   | 1.5 ms           |

The decision doc's "5,000 tasks take about 1.5 ms when nothing matches" holds only for ASCII text.

**Remedy, two steps, both behavior-identical:**

1. In the slow path, fold ASCII characters directly: `const folded = ch.charCodeAt(0) < 128 ? ch.toLowerCase() : ch.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();`.
2. Fold each field once and reuse it for both the prefilter and the scoring. `scoreTexts(texts, terms, folded = texts.map(fold))`, with the prefilter becoming `terms.every(term => folded.some(f => f.some(v => v.text.includes(term))))`.

My prototype (`/tmp/thermo01/search-fast.ts`) brings the accented case to 7-12 ms. Its output is identical to the real module on all 29 recorded `search` vectors, so the vectors are unchanged.

A `WeakMap<Task, Folded[][]>` cache would remove the remaining fold cost. Store tasks are replaced on change, so they are natural cache keys. That is the "cached index" the decision doc defers, and it is a one-line `get ?? set` here.

The Swift port has its own implementation and is worth the same check. Update the numbers in `docs/decisions/search.md`.

### F2. An unterminated quoted CSV field silently swallows the rest of a Todoist import [robustness] [CONFIRMED] [effort: S]

In `csv.ts:11-31`, once `quoted` becomes true, every following character, including newlines and commas, goes into the field until a closing `"`. If none ever comes, the loop ends and the remainder becomes one field with no signal.

Proof (`/tmp/thermo01/csvimp.ts`): this project file has a stray opening quote in the first task.

```
task,"Buy milk,,4,1,,,,,
task,Call mom,,4,1,,,,,
task,Pay rent,,4,1,,,,,
```

`readTodoistBackup` returns one task titled `"Buy milk,,4,1,,,,,\ntask,Call mom,…\ntask,Pay rent,,4,1,,,,,"`. Two tasks vanish, and `warnings` is `[]`.

Todoist's own exporter does not produce this, but a hand-edited file or a truncated upload does. The import already has a `warnings` channel (`todoist.ts:133`), so this should fail loudly. `parseCsv` should throw, or return an `unterminated` flag, when it ends with `quoted === true`. `readProject` then pushes `"<file> has an unclosed quote, skipped"` the way it already does for a non-Todoist file.

No current test pins the silent behavior. This is a behavior change: it adds a new csv vector, and Swift `Csv` needs the same change.

### F3. `feb 29` without a year stays text outside a leap year [bug] [CONFIRMED] [effort: S]

**What goes wrong.** `quick-add.ts:329-335` (`monthDay`) tries this year, then next year if the date has passed. When this year lacks the date, `calendarDate` returns `null` and the function returns `null` at once, without looking further.

On 2026-10-14 (`/tmp/thermo01/sweep.ts`):

- `x feb 29` → title `x feb 29`, due `null`.
- `x feb 29 2028` → due `2028-02-29`.
- `every feb 29` → also stays text, through the same path via `readRecurrence` → `resolveDate`.

The same happens on any date from March 1 of a leap year through Feb 28 of the next. `docs/decisions/quick-add.md` says "A date without a year is the next one, counting today." It reserves "stays text" for dates that do not exist (`feb 30`). Feb 29 exists. The neighbouring `the 31st` reader (`quick-add.ts:384-393`) already loops forward over months to find the next valid day. `monthDay` should do the same over years:

```ts
const year = Number(today.slice(0, 4));
for (let y = year; y <= year + 4; y++) {
	const key = calendarDate(y, month, day);
	if (key && key >= today) return key;
}
return null;
```

`feb 30` still returns `null`. No existing test mentions Feb 29. Fixing it adds vectors, and Swift `QuickAdd.monthDay` needs the same change.

Related, smaller: `calendarDate` uses `new Date(year, month, day)`, which maps years 0-99 to 1900-1999. So `pay 1/2/0050` parses as `1950-01-02`. The slash-date regex accepts any `\d{4}`. Use `setFullYear` or reject years below 1900.

### F4. Ramble priority parsing duplicates quick add's and can be deleted [simplification] [CONFIRMED] [effort: S]

**Current shape.** `ramble.ts:332` defines `PRIORITY_PHRASE` (`priority N` or `pN`). `readAttributes` (`ramble.ts:381-388`) matches it, takes the last match, adds a token, and blanks every match before calling `parseQuickAdd`. It then drops quick add's own priority tokens (`ramble.ts:391`, `token.kind !== 'priority'`). That filter is dead, because the text was already blanked.

Quick add already reads `p1`-`p4` in spoken mode and keeps the last one. The `priority N` form exists only because the normalizer rewrites spoken levels to `priority ${n}` (`ramble.ts:236-243`).

**After.** Have those two rewrites emit `p${n}` instead. Then delete:

- `PRIORITY_PHRASE`,
- the 8-line priority block in `readAttributes`,
- the `kind !== 'priority'` filter,

and return `priority: parsed.priority`. That removes about 12 lines and one of the two priority grammars.

The correction rewrite (`PRIORITY_WORDS`) already accepts `p[1-4]`, and the offset map keeps token spans pointing at `priority two` in the transcript, so tinting is unchanged.

**Proof.** `/tmp/thermo01/proto/ramble.ts` applies exactly this change. Its output is byte-identical to the real `parseRamble` on all 447 recorded `ramble` vector inputs (81 of them set a priority) and on all 443 corpus transcripts. It also matches on extra probes such as `fix bug, priority two, no wait priority three` and `p1 p2 p3`. The vectors are unchanged, but the Swift `RambleGrammar` should drop its copy in the same PR to stay a faithful port.

### F5. Ramble builds a titleless root's subtasks twice and emits duplicate tokens [bug] [CONFIRMED] [effort: S]

**What happens.** In `ramble.ts:935-980`, `build(item, true)` first builds every subtask with `isRoot = false`, and each `build` call pushes that subtask's tokens into the shared `tokens` array. Only then does it compute the root's title. When the title is empty, it returns `null`, and the loop at `ramble.ts:975-979` rebuilds each subtask as a promoted root. That pushes the same tokens a second time and re-runs `readAttributes` for every subtask.

Proof (`/tmp/thermo01/probe.ts`):

```
parseRamble('Tomorrow at 5pm. Subtask buy milk tomorrow at 6pm.', …).tokens
→ [["subtask",17,24],["due",34,49],["due",34,49]]
```

`Tomorrow. With subtasks buy milk on friday, eggs.` gives the same duplicated `due`.

**Impact.** The web `caption` (`app-web/src/lib/ramble/entries.ts:40`) and iOS `RambleDrawer.swift:284` both skip tokens that end before the cursor, so nothing renders twice today. Still, the `RambleDraft.tokens` contract is wrong, and every consumer must defend against it.

**Remedy.** Decide the root's fate before building children. Compute the root's attributes and title first. If the title is empty, build the subtasks once with `isRoot = true` and return them as promoted roots. Otherwise build them with `isRoot = false`. This removes the second loop and the double `readAttributes`.

No recorded vector contains a duplicate token (I checked all 447), so this fix leaves the vectors unchanged.

### F6. quick-add matches a date twice with two grammars that must agree [simplification] [PLAUSIBLE] [effort: L]

**Two copies of one grammar.**

1. The `DATE` alternation (`quick-add.ts:137-147`, plus `MONTH_DATE` and `MONTH_DAY`) recognizes a date phrase.
2. `resolveDate` (`quick-add.ts:430-440`) then lowercases it, spells ordinals as digits (`digitOrdinals`), and re-parses it through a second ordered table, `DATE_READERS` (`quick-add.ts:368-414`, 9 regexes). That table restates the same forms: weekday prefix, month/day in either order, `the Nth weekday of`, slash dates, and offsets.

**The risk.** A form that the first grammar accepts and the second rejects returns `null` from `read`. The text then silently stays in the title. My sweep of about 380 month/day forms found no disagreement today, so this is a maintenance hazard, not a live bug. Each new date form, though, must be added in two places with matching quirks, and four places once the Swift port is counted.

**Remedy.** Turn `DATE` into a list of `{ source, read }` entries, each alternative with its own named groups. Build the alternation from the list, and dispatch on whichever group matched, the way `readRecurrence` already dispatches on groups. That deletes `DATE_READERS`, the `digitOrdinals` re-lowercasing for dates, and the "resolve returned null" path for dates.

This only pays off if done together with the Swift port. Keep vectors identical as the acceptance test. I would not start it without a reason to touch date grammar anyway.

## Smaller notes

**zoned-time.ts is correct.** `zonedTime`, which checks the offsets one day on either side, agrees exactly with the process-zone `Date` in all 7 zones tested, including the 30-minute Lord Howe shift, Havana's midnight transition, and Apia's 2011 skipped day. Gaps land after the jump and overlaps take the first instance, as documented. `addedAgo` uses `Date.parse` on date keys (UTC midnight on both sides), so DST cannot skew the day count. No action.

**Duplicated small helpers.**

- `escapeRegExp` is defined identically in `quick-add.ts:619` and `ramble.ts:271`.
- `ordinal()` exists twice with different rules: `format.ts:88` handles 111/112, while `ramble.ts:140` only checks 11/12/13. Both see only 1-31, so they agree today.
- `ORDINAL_WORDS` is an array in quick-add.ts and a record in ramble.ts.

Export one copy of each from quick-add.ts or format.ts. This is a pure refactor and the vectors stay identical.

**Repeated entries in `VERBS`.** The list (`ramble.ts:472-643`) has `take`, `download`, `cook`, `sweep`, `pay`, `apply`, and `sign` twice each. The `Set` hides it. Deleting the repeats changes nothing.

**Today/tomorrow/yesterday ladder.** `format.ts` writes it three times (`formatDate`, `relativeDay`, `completedHeading`) and the "weekday name within 7 days" branch twice (`formatDate`, `dayHeading`). `formatDate` could be `relativeDay(date, today) ?? (withinWeek ? weekdayLong : shortDate(date, today))`. That saves about 8 lines, and the vectors stay identical.

**Redundant code in quick-add.ts.**

- `quick-add.ts:809`: `place && isSavedPlace(place)` re-checks a property that `placeId` already guarantees, since it only comes from the saved-place rule.
- `quick-add.ts:679-681`: `options.spoken ?? false` and `options.labels ?? []` restate the schema defaults, because `ParseOptions` is `z.input`. Either parse the options or drop `.default()` from the schema, so the defaults live in one place.

**Possible cross-slice type change.** `dictation.ts:17`: `voiceCaptureSchema.engine` restates `['native', 'elevenlabs']` instead of reusing `dictationChoiceSchema`. Reusing it would change the generated Swift type from an inline enum to `DictationChoice`. That is probably desirable, but it touches iOS.

**Silent name collisions.** quick add's `namedRule` keys names case-insensitively, so two projects named `Home` and `home` resolve to whichever comes last. Ramble's `nameKey` also strips a trailing `s`, so `Home` and `Homes` collide. Both are edge cases and are not worth code now.

**Ramble performance is fine.** A 2.4k-char transcript (67 tasks) parses in about 2 ms warm. Re-parsing it as 28 streamed partials totals about 22 ms. The repeated `readAttributes` calls (for attach, attributes-only, and build) are not a problem at realistic transcript lengths.

**Name suggestions are fine.** `lastUsed` scans `store.tasks` on each fragment keystroke in `SmartInput.svelte:97`. That is O(tasks), well under 1 ms at 3000 tasks.

## Test coverage observations

- No test covers a leap-day date without a year (F3), a slash date with a year below 100, or an unterminated CSV quote (F2).
- `ramble.test.ts` asserts tasks well but checks `tokens` only loosely. A token-uniqueness check over the whole corpus (no two tokens with the same kind, start, and end) would have caught F5.
- `search.test.ts` pins ranking and highlighting with literal expectations, which is good. Nothing guards the performance claim in the decision doc. A coarse benchmark over 3000 tasks with accented notes would keep the doc honest, though it would be optional and outside CI.
- quick-add.test.ts is behavior-first and thorough: literal inputs and outputs, organized by the decision doc's sections. It is the reason a grammar restructure like F6 is feasible at all.
