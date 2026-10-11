# Ramble design

Ramble turns a spoken brain dump into tasks. Stefan talks, a live transcript and a preview list of tasks grow as he speaks, and he confirms, edits, or discards each task before saving. This document is the research and the design. The lasting decisions are in [Ramble](decisions/ramble.md); the build slices are at the end.

## Recommendation in short

- **Transcription:** ElevenLabs **Scribe v2 Realtime** over a WebSocket, proxied through the `Account` Durable Object at `GET /api/ramble/socket`, with keyterms built from Stefan's project and label names. About **$0.47 per hour of audio**, under a cent per minute.
- **Extraction:** the **hybrid** option. A deterministic spoken grammar in `shared/ramble.ts` splits the transcript into tasks, subtasks, and notes, reads spoken triggers such as `project Home` or `priority one`, and runs our quick add parser on each task for dates, times, recurrence, and reminders. Metadata only ever comes from words Stefan said. An LLM is an optional later slice that may only regroup sentences, never add metadata, and it ships only if the test corpus shows the grammar segments natural rambles badly.
- **Clients:** web and iOS together, sharing one endpoint and one parser (ported to Swift through the shared test vectors). The Apple Watch is excluded until its app exists.
- **Testing:** a corpus of several hundred transcripts with expected structured output, recorded as `shared/vectors/ramble.json` and replayed by the Swift port, with a hard gate that no field is ever set without a spoken phrase behind it. Real audio fixtures and recorded transcription "cassettes" drive paired Playwright and XCUITest flows without a key in CI.

## Goals and non-goals

- **Goals.** Many tasks from one session. Nested subtasks, a title and notes, project, labels, priority, due date and time, reminders, and recurrence. A live transcript and a live preview. Edit and discard per task before saving, and one undo for the whole batch. Snappy: words appear within a few hundred milliseconds, and the preview updates on every transcript change without a round trip.
- **Precision over recall.** Ramble must not be finicky or over-eager. It never sets a field Stefan did not say, never creates a project or label, and never turns ordinary words like "project", "important", or "Tuesday's" into metadata on its own. A missed attribute costs one tap in the preview. An invented one costs trust.
- **Non-goals for now.** Conversation ("what's due today?"), editing existing tasks by voice, languages other than English for the grammar, wake words, background or lock-screen capture, the Apple Watch, and offline transcription.

## Clients

Following the workflow rule in [Workflow](decisions/workflow.md#clients), every feature names its target clients and why any are left out.

| Client                  | Target  | Why                                                                                                                                                                                                             |
| ----------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web (desktop and phone) | Yes     | Stefan's daily client. Desktop Chromium and iPhone Safari both have `getUserMedia` and `AudioWorklet`.                                                                                                          |
| iOS app                 | Yes     | Voice capture matters most on the phone. It uses the same `/api/ramble/socket` endpoint and the same parser through the Swift port.                                                                             |
| Apple Watch             | Not now | The watch app does not exist yet. When it does, Ramble is a natural subset for it: hold to talk, a short preview, and save. It would reuse the same endpoint and `Core` parser, with no editing beyond discard. |

Web and iOS are planned together: each UI slice has a twin on the other client, written against the same parity ids and scenarios listed under [Paired parity tests](#paired-parity-tests), and the shared logic lands once in `shared/` with its Swift port.

## How Todoist Ramble behaves

From Todoist's help center, product updates, Doist's engineering write-up, and reviews:

- **Toggle, not hold.** You tap the waveform icon in Quick Add or the sidebar (or `Shift+Q`, and a global desktop shortcut), talk, and end by saying "that's all" or clicking **Add tasks** in the preview. On iOS it can also start from a widget, a lock-screen control, or the Action Button. The docs describe no hold-to-talk mode. ([Dictate to add tasks with Ramble](https://www.todoist.com/help/articles/dictate-to-add-tasks-with-ramble-P1Raq7vVF), [Ramble launch post, Jan 21 2026](https://www.todoist.com/help/todoist/product-updates/turn-your-scattered-thoughts-into-clear-tasks-ramble-jan-21-2026-HhmP8ue8R))
- **Live preview while you talk.** Tasks appear in a preview as you speak, "not after you finish". Todoist calls it "a quick capture tool rather than a conversational assistant", and asks you to "say each task clearly before moving to the next one". ([help center](https://www.todoist.com/help/articles/dictate-to-add-tasks-with-ramble-P1Raq7vVF))
- **Voice edits.** "Actually, I meant…" edits the last task and "Remove that" deletes it. Tasks can also be edited or removed in the preview before adding. ([help center](https://www.todoist.com/help/articles/dictate-to-add-tasks-with-ramble-P1Raq7vVF))
- **What it extracts.** Titles, dates, deadlines, priorities, durations, and, since a later update dated October 21, existing projects and labels ("Book flights, add it to the Indonesia project"; "add it to the Finance project with the urgent label"). Project and label selection launched on web and desktop first. ([Add projects and labels in Ramble](https://www.todoist.com/nl/help/articles/add-projects-and-labels-to-new-tasks-in-ramble-october-21-TnBYTGqQl), [todoist.com/ramble](https://www.todoist.com/ramble))
- **How it is built.** Raw PCM audio streams to Gemini's Live API, which transcribes and understands in one pass and calls tools such as `addTask`, `editTask`, and `deleteTask` as you speak. Doist evaluated it with over 100 recordings by native speakers in 15+ language variants, each with an expected semantic outcome such as "should create 3 tasks: one about calling family, one about shopping, one about exercise on Saturday at 11 AM". ([Google Cloud blog: The Blueprint, Doist](https://cloud.google.com/blog/topics/startups/the-blueprint-doist-stream-of-consciousness-ai-task-list-creation))
- **Reviews.** Reviewers like it for walks and morning brain dumps, and it infers freely: PCMag's "replace my air conditioner filter in six months. Wait, no, five months" became a task due in five months. That freedom is what we trade away for precision. ([PCMag review](https://au.pcmag.com/productivity/84696/todoist), [XDA hands-on](https://www.xda-developers.com/todoist-ramble/))

What we copy: the toggle session, the live preview, edit before save, existing projects and labels only, "remove that". What we change: a deterministic grammar instead of a free LLM, so nothing is set that was not said; hold-to-talk as a second mode; "that's all" stops listening but does not save on its own.

## Transcription

### Options

`scribe_v1` is deprecated in the ElevenLabs model list with removal scheduled for July 9, 2026 ([Models](https://elevenlabs.io/docs/overview/models.mdx), [changelog](https://releases.fru.dev/releases/elevenlabs-2026-06-08-speech-to-text)). Stefan's key check shows it still answers, but nothing should be built on it. The live choice is between Scribe v2 batch and Scribe v2 Realtime.

|                                | Scribe v2 (batch)                                                                   | Scribe v2 Realtime                                                                                 |
| ------------------------------ | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Model id                       | `scribe_v2`                                                                         | `scribe_v2_realtime`                                                                               |
| API                            | `POST /v1/speech-to-text`, upload a file                                            | WebSocket `/v1/speech-to-text/realtime`, stream PCM                                                |
| Latency                        | Whole clip after you stop; a 30 to 60 second clip is expected to take a few seconds | About 150 ms to partial text, committed segments after a VAD silence                               |
| Price (API, per hour of audio) | $0.22, plus $0.05 for keyterms                                                      | $0.39, plus $0.08 for keyterms                                                                     |
| Keyterms                       | Up to 1000 terms, 50 characters each                                                | Up to 50 terms, 20 characters each                                                                 |
| Language                       | Auto-detect with `language_code` and probability, or a pinned `language_code`       | Pinned `language_code`, or auto with `include_language_detection`                                  |
| Other                          | Diarization, audio events                                                           | Partial and committed transcripts, `no_verbatim` to drop fillers and false starts, word timestamps |

Sources: [ElevenLabs API pricing](https://elevenlabs.io/pricing/api), [Speech to text overview](https://elevenlabs.io/docs/overview/capabilities/speech-to-text.md), [Keyterm prompting](https://elevenlabs.io/docs/eleven-api/guides/cookbooks/speech-to-text/batch/keyterm-prompting), [Realtime API reference](https://elevenlabs.io/docs/es/api-reference/speech-to-text/v-1-speech-to-text-realtime.md), [Single-use tokens](https://elevenlabs.io/docs/api-reference/tokens/create.mdx), [Commit strategies](https://elevenlabs.io/docs/eleven-api/guides/how-to/speech-to-text/realtime/transcripts-and-commit-strategies.mdx).

### Pick: Scribe v2 Realtime

- **The live transcript is the feature.** Todoist's Ramble feels alive because tasks appear while you talk. Batch would show nothing until Stefan stops, then a spinner, which breaks the snappy bar.
- **The price gap is noise at one user.** Realtime with keyterms costs about $0.0078 a minute against $0.0045 for batch.
- **50 keyterms is enough** for Stefan's projects and labels, picked by recency (below). Batch's 1000 would matter only with hundreds of names.
- **Fallback.** If realtime proves flaky through the proxy, the same Durable Object can buffer the PCM and post it to batch `scribe_v2` on stop. The parser and UI do not change, only the transcript arrives at once.

### Session settings

- `audio_format=pcm_16000` (16 kHz, 16-bit little-endian mono), the recommended format, about 32 KB a second.
- `commit_strategy=vad` with `vad_silence_threshold_secs` around 1.0. A commit is a stable segment; partials replace each other. On stop, the proxy sends a final commit so the last words land.
- `language_code=en`, pinned. The grammar is English-only, and pinning avoids misdetection on short clips. Auto-detection is a one-line change if Stefan wants to ramble in other languages; titles would transcribe fine and the grammar would simply find no metadata.
- `no_verbatim=true`, so "um" and false starts leave titles. The corpus audio checks it does not swallow correction phrases like "scratch that"; if it does, turn it off.
- `keyterms`: up to 50, each at most 20 characters. The Durable Object already holds the synced projects and labels, so it builds the list itself: the trigger words (`subtask`, `priority`, `remind`, `project`, `label`), then project and label names ordered by the same recency as `#` and `@` autocomplete, skipping names over 20 characters. Keyterms are context-aware ("relies on the context to decide whether to transcribe that term"), so a label named `calls` does not turn every "calls" into a label; the grammar still needs its trigger word.

### Endpoint and proxy

The browser may only talk to its own origin ([Dev hosting](decisions/dev-hosting.md)), and the key stays server-side, so the client never connects to ElevenLabs and never sees a single-use token.

```
client (web or iOS)                 Worker              Account Durable Object                 ElevenLabs
  GET /api/ramble/socket  ──────►  routes  ──────►  authenticate device token
  (subprotocol bearer.<token>                       check daily minutes cap
   or Authorization header)                         build keyterms from synced names
                                                    fetch(wss upstream, xi-api-key) ────────►  session_started
  binary PCM frames (100 ms) ─────────────────────► forward as input_audio_chunk ──────────►
  ◄──────────────────────────────────────────────── { type: partial | committed, text } ◄───  partial_transcript /
                                                                                              committed_transcript
  { type: "stop" } ─────────────────────────────►   final commit, then close
  ◄──────────────────────────────────────────────── { type: "ended", seconds }
```

- **Why the Durable Object and not the plain Worker.** On the Workers Free plan a WebSocket upgrade is one request with 10 ms of CPU for its whole life, and forwarding about ten frames a second for a minute (base64 encoding included) would likely exceed it. A Durable Object's CPU budget resets with every incoming WebSocket message, so a long ramble is safe. The `Account` object already authenticates devices and holds the names for keyterms, so it needs no new binding. ([Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Durable Object limits](https://developers.cloudflare.com/durable-objects/platform/limits/))
- **No hibernation for this socket.** An open upstream socket keeps the object awake, which is billed duration. A 60 second ramble is 7.5 GB-s against 13,000 GB-s free a day, so even an hour of rambling a day is about 450 GB-s.
- **Auth.** Ramble costs money per minute, so it needs a paired device, authenticated exactly like the realtime nudge socket ([Sync](decisions/sync.md#realtime-nudge)): the web sends `procrastimate.ramble` and `bearer.<token>` as subprotocols, iOS sends `Authorization: Bearer`. An unpaired device shows the mic button with `Turn on sync to use Ramble`.
- **Caps.** A session stops itself after 5 minutes. The object counts seconds per day in its storage and refuses new sessions past 60 minutes a day with a clear message. Both are constants Stefan can change. They bound the damage of a leaked device token to well under a dollar a day.
- **Thin client protocol.** Clients send binary PCM frames and one `stop` message, and receive `partial`, `committed`, `ended`, and `error` messages. The contracts live in `shared/ramble/protocol.ts` with zod, like `shared/sync/protocol.ts`. Keyterms, language, and VAD settings are server-side, so tuning them never needs a client release.
- **Dev and tests.** The Bun dev server hosts the same handler through the existing `SocketHost`. With `ELEVENLABS_API_KEY` set it talks to ElevenLabs. Without it, or with `RAMBLE_UPSTREAM=cassette`, a fake upstream replays a recorded cassette (see [Testing](#testing)), so Playwright and XCUITest never need the key.
- **Secret.** `ELEVENLABS_API_KEY` is already a Worker secret on `procrastimate`. It is never a `vars` entry, never in CI, never in the repo. Locally the Bun server reads it from root `.env.local` through env-manager (an optional server-target entry, like `SYNC_SETUP_CODE`) and `wrangler dev` from `.dev.vars`. Without it, `/api/ramble/socket` answers `503` and the mic button says Ramble is unavailable.

### Audio capture

- **Web.** `getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })` into an `AudioWorklet` that downsamples to 16 kHz Int16 and posts 100 ms frames (3,200 bytes) to the socket. The worklet also reports a level for the mic animation. The stream stops when the session ends, so the browser's recording indicator goes away at once.
- **iOS.** `AVAudioSession` in `.record` with `.measurement` off and voice processing on, an `AVAudioEngine` input tap through `AVAudioConverter` to 16 kHz Int16, 100 ms frames over `URLSessionWebSocketTask`. `NSMicrophoneUsageDescription` explains Ramble. Haptics: a light impact when listening starts and stops, success on save.
- **Measured latency.** The design's numbers come from ElevenLabs' docs. This research VM has no access to the key (no env-manager, no environment variable), so no real-audio test ran here. Slice R1 measures, on the deployed Worker from Stefan's network: time to `session_started`, time from speech to first partial, VAD commit delay, and stop-to-final-commit, and records them in [Ramble](decisions/ramble.md). Expected: under 500 ms to the first partial and about 1 to 1.5 seconds to a commit after a pause.

## Extraction

The extractor turns the transcript into a draft:

```ts
type RambleDraft = {
	tasks: RambleTask[];
	tokens: RambleToken[]; // every recognized phrase with its kind and UTF-16 span, for tinting and provenance
};

type RambleTask = {
	segment: { start: number; end: number }; // span of the transcript this task came from
	title: string;
	notes: string;
	due: Due | null;
	recurrence: Recurrence | null;
	priority: Priority | null;
	reminders: Reminder[];
	projectId: string | null;
	labelIds: string[];
	subtasks: RambleTask[]; // subtasks carry no projectId; they take the root's
};
```

It is a pure function of the transcript text, `now`, the projects, and the labels, so it reruns on every partial (a few milliseconds) and the preview never waits on the network. It runs on both clients and is covered by the shared vectors.

### Three options

|                                 | (a) Explicit trigger grammar                             | (b) LLM extraction                                                                        | (c) Hybrid (recommended)                                                                                            |
| ------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| How                             | Fixed spoken phrases set every attribute and split tasks | A model reads the transcript and returns tasks as JSON                                    | (a) for metadata and explicit structure, the quick add parser for dates, an LLM only to regroup sentences if needed |
| Precision                       | Highest. Nothing fires without its phrase                | Lowest. Models infer ("sounds urgent", "probably the Work project") and paraphrase titles | Same as (a): every field traces to a phrase                                                                         |
| Segmentation of natural rambles | Weak without separators                                  | Strong                                                                                    | Strong where needed                                                                                                 |
| Latency                         | Instant, local                                           | 0.6 to 2.5 s per call, needs the network                                                  | Instant; the optional LLM step adds about a second, once                                                            |
| Live preview                    | Every partial                                            | Only by calling the model repeatedly                                                      | Every partial                                                                                                       |
| Cost                            | Free                                                     | Small (below)                                                                             | Free unless the LLM step is on                                                                                      |
| Testability                     | Exact, deterministic vectors on both clients             | Fuzzy, semantic scoring, drifts with model versions                                       | Exact for metadata, fuzzy only for the optional grouping                                                            |
| Client parity                   | Shared code, ported once                                 | Server-only, both clients get it                                                          | Shared code plus one server call                                                                                    |

**(b) in detail.** Candidates: on Cloudflare, `@cf/meta/llama-3.3-70b-instruct-fp8-fast` supports JSON Schema output ([JSON mode](https://developers.cloudflare.com/workers-ai/features/json-mode/)) at $0.293 per million input and $2.253 per million output tokens, about 106 neurons per ramble call, so the free 10,000 neurons a day cover about 90 calls; `@cf/openai/gpt-oss-20b` is cheaper but is not on the JSON mode list ([Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)). Externally, Gemini 2.5 Flash-Lite ($0.10 and $0.40 per million, with structured outputs, about 576 ms median in a recent benchmark) is the cheapest fast option, but Google now limits 2.5 models to existing users and points new projects to newer Flash-Lite models; Gemini 3.1 Flash-Lite is $0.25 and $1.50 ([Gemini 2.5 Flash-Lite](https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-lite), [latency brief](https://cutoffreport.com/posts/cutoff-data-brief-2026-10-08)). GPT-5 nano is $0.05 and $0.40 but measured slower, about 2.5 s ([TokensWatch](https://tokenswatch.net/compare/gpt-5-nano-vs-gemini-2-5-flash-lite/)). Any of these is a fraction of a cent per ramble. The problem is not cost; it is that a model told to extract priority will find priority, and the "never invent metadata" target would rest on a prompt.

**Recommendation: (c).** The grammar gives exact, testable, instant results and both clients run it locally. Dates and recurrence reuse the quick add parser, which already handles Stefan's phrasing and its guards. The LLM is kept out of the metadata path entirely. If the corpus shows natural, separator-free rambles segment badly, slice R7 adds an LLM step whose only output is a grouping of verbatim sentences, which by construction cannot invent a project, a date, or a word of a title.

### The spoken grammar

The grammar runs in four passes over the transcript. Every pass records the spans it recognized as tokens, like quick add, so the live transcript can tint them and the tests can prove provenance.

**1. Normalize** (spans map back to the original text):

- Number words to digits where a number is expected: `two weeks` → `2 weeks`, `thirty minutes before` → `30 minutes before`, `priority one` → `priority 1`. Never `to`, `too`, or `for` on their own, except in the priority slot (below).
- Spoken times: `5 p.m.`, `5 P.M.`, `five pm` → `5pm`; `half past five`, `quarter to six` → `5:30`, `5:45` only when followed by `am`/`pm` or after `at`.
- Scribe writes most numbers as digits already. The normalizer is for the cases it does not.

**2. Segment** into tasks:

- **Explicit separators** always split: `next task`, `new task`, `another task`, `next one`, `and another thing`. They are removed from titles.
- **Sentence boundaries** from Scribe's punctuation split by default: each sentence starts a new task, unless it opens with a **continuation cue**, in which case it attaches to the current task: `note`, `notes`, `the note is`, `details`, `remind me`, `priority`, `project`, `in project`, `label`, `tag it`, `it's due`, `due`, `make it`, `every`, `subtask`, `with subtasks`.
- **A sentence that is only attributes attaches too.** If nothing but recognized phrases and joining words would be left as its title, as in "Buy milk. Tomorrow at 5pm.", it belongs to the task before it.
- **VAD commits are not boundaries.** A commit only means Scribe heard a pause and the text before it is stable. Segmentation reads the joined committed text plus the current partial, so a pause in "Buy milk … tomorrow" never splits a task.
- **Subtasks.** `subtask <title>` or `add a subtask <title>` adds a child to the current top-level task. `with subtasks A, B, and C` (or `sub tasks`, `sub-tasks`) splits a list on commas and `and` into children. Voice nests one level; deeper nesting is done in task details. A subtask's own date, priority, reminders, and labels follow the same rules as a task; `project` phrases in a subtask are ignored, because a subtask takes its root's project ([Subtasks](decisions/subtasks.md)).
- **Notes.** Text after `note`, `notes`, `the note is`, `add a note`, or `details` goes to the task's notes, up to the next separator or cue, verbatim.
- **Voice corrections.** `scratch that`, `remove that`, `delete that`, and `never mind` drop the task being spoken (or the last one, if said at the start of a sentence). `Actually, I meant …` is not supported by the grammar; Stefan edits in the preview instead. It is a candidate for R7.
- **Ending.** `that's all` and `that's it` at the very end stop listening and are dropped from the transcript. They never save.

**3. Read spoken attributes** in each segment, in this order, each claiming its text so later rules never reread it:

- **Project:** `project <Name>`, `in project <Name>`, `to the <Name> project`, `in my <Name> project`, `add it to <Name> project`. `<Name>` must match an existing project, case-insensitively, ignoring punctuation and a trailing plural `s`. An unknown name stays text, so "finish the project report" keeps its title. Ramble never creates projects.
- **Labels:** `label <name>`, `labels <a> and <b>`, `tag <name>`, `with the <name> label`. Existing labels only; every match counts, like quick add.
- **Priority:** only `priority 1` to `priority 4` and `p1` to `p4` (spoken "pee one" normalizes). The priority slot also accepts the homophones `won`, `to`, `too`, `for`, `fore` for 1, 2, 2, 4, 4, but only directly after `priority` and at the end of a clause, so "priority to finish the deck" stays text. Quick add's `urgent`, `important`, `!!!`, and `!!` do not count in speech, because people say "important" in passing.
- **Reminders:** quick add's `remind me …` forms, plus `remind me 30 minutes before` and `remind me at 4pm` after normalization.
- **Dates, times, and recurrence:** the remaining segment text goes through `parseQuickAdd` with a new `spoken: true` option (below), and no projects or labels, so `#` and `@` never apply.

**4. Assemble.** The leftover text is the title, trimmed of joining words left at the edges (`and`, `also`, `then`, `I need to`, `I have to`, `I should`, `don't forget to`, `remember to`) and with its first letter capitalized. A segment whose title is empty after that is dropped. Defaults come from where Ramble was opened, exactly like quick add: a project screen sets the project, a label view adds the label, Today sets today. Spoken values win over defaults.

### Quick add changes for speech

`parseQuickAdd` gains `spoken?: boolean` in `ParseOptions`. Typed quick add is unchanged. With `spoken`:

- `urgent`, `important`, `!!!`, and `!!` are not priorities (the grammar reads priority itself).
- A bare four-digit number is never a time, so "call 1800 flowers" stays text; `at 1730` still works.
- Compact units (`5m`, `2h`, `2d`, `1w`, `3mo`) do not apply, since speech says "5 minutes" and Scribe writes "5M" for millions.
- A weekday followed by `'s` stays text, so "review Tuesday's notes" sets no date.
- Every other rule, guard, and order is the same. The new cases are recorded in `shared/vectors/quick-add.json`, so the Swift port changes with it.

### Optional LLM segmentation (slice R7, conditional)

- **Trigger.** Only when the corpus's natural-ramble category misses the segmentation target (below) after the grammar is tuned.
- **When it runs.** Once, after Stefan stops, on the final transcript, only if the grammar found no explicit separators and more than one sentence. The preview shows the grammar's result immediately and settles into the LLM's grouping when it returns, animated.
- **Contract.** Input: the transcript split into numbered sentences. Output, by JSON schema: `{ groups: [{ sentences: number[], parent: number | null, title: number, notes: number[] }] }`. The server validates that every sentence appears exactly once and in order, else it falls back to the grammar. The grammar then runs on each group as one segment, so all metadata still comes from spoken phrases.
- **Model.** Workers AI `@cf/meta/llama-3.3-70b-instruct-fp8-fast` with JSON schema output: no new vendor or secret, an `AI` binding on the Worker, inside the free 10,000 neurons a day for Stefan's volume. Gemini Flash-Lite is the fallback if Workers AI is too slow or ignores the schema; it would need a `GEMINI_API_KEY` Worker secret.
- **Endpoint.** `POST /api/ramble/segment`, device-authenticated, returning the groups. Clients merge them with a shared `applyGrouping(draft, groups)` that is part of the vectors.

## UX

The design follows [Visual language](decisions/visual-language.md) and [UX principles](decisions/ux-principles.md): glass only for floating chrome, capsule chips, springs, 44 pt targets, and the same accessible names on both clients.

### Entry points

- **In quick add.** A mic button (`Ramble`) at the trailing end of the input row, the way Todoist puts the waveform in Quick Add. Tapping it turns the quick add sheet into the Ramble sheet in place, morphing from the button.
- **From the add button.** Long-pressing the floating add button opens Ramble directly and starts listening (iOS: `.glassProminent` button with a context gesture and a haptic; phone web: the same long-press). A plain tap still opens quick add.
- **Keyboard.** `Shift+Q` opens Ramble on desktop web and on iPad with a hardware keyboard, matching Todoist.
- **Later, iOS only.** A Control Center and Action Button control through an App Intent, like Todoist's. Not in the first slices.

### The Ramble sheet

From top to bottom:

1. **Live transcript.** Committed text in `ink`, the current partial in `muted`, recognized phrases tinted with the same token colors as quick add. It scrolls to follow, at most three lines tall on a phone, so the preview stays visible.
2. **Preview list.** One card per task, in spoken order, appearing with a spring as each segment closes and updating in place as partials refine it (keyed by segment, so cards never rebuild). Each card shows the title, a one-line notes preview, and the chips row: project, labels, date and time, repeat, priority, reminders. Subtasks sit indented under their parent with a hairline, like task details.
3. **Controls.** A large mic button with a level ring: `Stop listening` while live, `Resume` after. Next to it the primary `Add 3 tasks`, disabled at zero. `Cancel` in the toolbar discards the session after a confirm if there are tasks.

Per task:

- **Tap a card to edit.** It expands into the shared smart input (the same component as the task details title), prefilled with the title and the chips, and the chips' pickers work as in quick add. Editing pauses nothing; listening continues and new tasks append below.
- **Discard.** An `x` on the card, a trailing swipe on iOS and touch web. A discarded card collapses; `Undo` appears in place for a few seconds.
- **Keep is the default.** There is no per-task confirm step; everything left in the list is added.

### Modes

- **Tap to toggle** is the default, like Todoist: tap the mic to start, tap again to stop. Stopping leaves the preview for review.
- **Hold to talk.** Press and hold the mic (or the add button) to listen while held; releasing stops and leaves the preview. Good for one quick task while walking.
- **"That's all"** stops listening. It never saves on its own, unlike Todoist, so an accidental phrase cannot add tasks.

### Saving and undo

- `Add 3 tasks` adds every task in one store command, so it is one sync batch and one undo step. Subtasks get fractional `order` under their parent ([Sync](decisions/sync.md#conflicts)).
- The sheet closes and a glass toast reads `Added 3 tasks` with `Undo` for five seconds, which removes all of them.

### States and errors

- **Unpaired device:** the mic shows `Turn on sync to use Ramble`, linking to Settings.
- **Offline or server unavailable:** `Ramble needs a connection`. Transcription is the one online-only step in a local-first app; a session that loses the connection keeps its transcript and preview, and Stefan can still edit and add those tasks.
- **Mic permission denied:** an inline explanation and, on iOS, a link to the app's Settings page.
- **Daily cap reached:** `Ramble's daily limit is used up` with the reset time.
- **Reduce Motion:** cards appear without springs; the level ring becomes a static dot.

### Accessible names (shared)

`Ramble`, `Stop listening`, `Resume`, `Add <n> tasks`, `Discard task`, `Edit task`, `Cancel`, `Live transcript`, and the toast `Added <n> tasks` with `Undo`. XCUITests read chips through the same accessibility-identifier convention as the smart input (`due: tomorrow 5pm; priority: p1`).

## Testing

Testing is most of the risk and most of the work. Four layers:

### 1. The transcript corpus (shared vectors)

- **Where.** `shared/fixtures/ramble-corpus.ts` holds cases `{ id, category, transcript, projects?, labels?, expected }`, with one shared seed of projects (`Home`, `Work`, `Side Project`, `Indonesia`, `Finance`) and labels (`calls`, `errands`, `waiting`, `deep work`). `shared/ramble.test.ts` asserts each case's `parseRamble` output against `expected` with the pinned clock (Wednesday, October 14 2026, 10:00), wrapped in `recorded('ramble', parseRamble)`, so `bun run vectors` writes `shared/vectors/ramble.json` and the iOS `VectorTests` replay every case against the Swift port. One source of truth, as in [iOS app](decisions/ios.md#shared-logic-and-test-vectors).
- **Size and categories.** At least 300 cases at first, growing with every bug:

| Category                             | Cases | Examples                                                                                                                                                                                             |
| ------------------------------------ | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No metadata at all                   | 40    | "Buy milk. Call the plumber about the leak." → two tasks, every field empty                                                                                                                          |
| Single task, one attribute each      | 40    | "Pay rent tomorrow", "Email Dana priority 2", "Water plants every Sunday", "Book flights, add it to the Indonesia project"                                                                           |
| Multi-task with explicit separators  | 30    | "Buy paint next task call mom tonight new task renew passport"                                                                                                                                       |
| Multi-task natural (no separators)   | 40    | "I need to buy milk, oh and call mom tomorrow, and the report's due Friday"                                                                                                                          |
| Subtasks                             | 25    | "Plan the party with subtasks invitations, cake, and music"; "Clean garage. Subtask sort tools."                                                                                                     |
| Notes vs title                       | 20    | "Buy paint. Note: the blue one from Home Depot."                                                                                                                                                     |
| Trigger words used as ordinary words | 40    | "Finish the project report", "Label the boxes in the garage", "Note to self buy stamps" (stays a title), "This is important, call the bank", "Review Tuesday's notes", "Priority to finish the deck" |
| Numbers                              | 25    | "Call 1800 flowers", "Buy 2 tickets for May 3rd", "Read chapter 5", "Order 5M screws" (no 5 minutes), "Team of 4 dinner at 7pm"                                                                      |
| Homophones and ASR slips             | 20    | "priority for" → p4, "priority won", "pee one", "remind me too" (stays text), "four tickets" vs "for tickets"                                                                                        |
| Unknown names                        | 15    | "project Garden" with no such project → stays in the title; "label urgent" with no such label → stays                                                                                                |
| Corrections and endings              | 15    | "Buy eggs scratch that buy bread", "that's all"                                                                                                                                                      |
| Dates and recurrence in speech       | 30    | "every other week on Monday", "in two weeks", "at half past five pm", "next Friday at noon", "remind me 30 minutes before"                                                                           |

- **Precision is the hard gate.** For every case, every non-empty field (`projectId`, each label, `priority`, `due`, `recurrence`, each reminder) must have a token whose span lies in that task's segment. CI fails on any field without provenance. The "no metadata" and "trigger words used as ordinary words" categories must produce exactly zero metadata.
- **Targets**, measured by a scorer in the test file and printed as a summary:

| Metric                                             | Target                        |
| -------------------------------------------------- | ----------------------------- |
| Invented fields (metadata without a spoken phrase) | 0, hard gate                  |
| Metadata precision on cases that state metadata    | 100%                          |
| Metadata recall on cases that state metadata       | ≥ 95%                         |
| Exact task count, explicit-separator cases         | 100%                          |
| Exact task count, natural cases                    | ≥ 90% (below this, R7 starts) |
| Exact title after normalizing case and punctuation | ≥ 90%                         |
| Subtask structure exact                            | ≥ 95%                         |

- **Locked cases and scored cases.** The corpus has two sets. _Locked_ cases assert their exact expected output and are recorded as vectors, so any change in their behavior fails CI on both clients; every hand-written precision case (no metadata, trigger words used normally, numbers, homophones, unknown names) is locked from the start. _Scored_ cases, mostly natural multi-task rambles, are not asserted one by one. The scorer runs them, prints the metrics above, and fails only when a metric falls below its target; the provenance gate still applies to every scored case. A scored case moves to the locked set once it passes, so wins stick. This lets R2 merge with natural segmentation at its target rather than perfect, and gives R7 a measured gap to close.

- **Synthetic generation.** A small generator (`shared/fixtures/ramble-generate.ts`) composes known titles, attribute phrases, and separators into transcripts whose expected output it knows by construction, seeded so the output is stable. Hand-written cases cover the tricky categories; generated ones cover combinations. Both live in the corpus file, regenerated deterministically.

### 2. Real audio fixtures

- **What.** About 10 clips of 10 to 30 seconds covering the categories above, stored as 16 kHz mono 16-bit PCM WAV in `shared/fixtures/ramble-audio/` with a manifest `{ id, file, transcriptExpected, draftExpected }`. WAV is what Chromium's `--use-file-for-fake-audio-capture` plays, and its samples are exactly the PCM the socket carries, so the iOS fixture feed and the live check read the same file with no conversion. At 32 KB a second, three minutes of clips is about 6 MB.
- **Making them.** Stefan's key appears scoped to speech to text (Stefan saw `/v1/models` return `401`), so ElevenLabs TTS may not work with it. Options, in order: a second, TTS-scoped ElevenLabs key used only on Stefan's machine to generate the files once (`eleven_flash_v2_5`, a few cents for all clips, inside the free plan's TTS allowance); an offline TTS such as Piper; or Stefan recording them himself on his phone, which is the most realistic. The generator script never runs in CI.
- **Cassettes.** For each clip, a one-time live run through our proxy records ElevenLabs' message stream (partials, commits, timings) into `<id>.cassette.json`. The dev server's fake upstream replays a cassette in real time, so the full flow (capture, socket, partials, preview, save) runs in CI without a key.
- **Live check.** `bun run ramble:live` (manual, needs the key locally) streams each clip through the real proxy, scores word error rate against `transcriptExpected` (target ≤ 5%) and the draft against `draftExpected`, prints latency numbers, and refreshes cassettes when asked. It is run by the slice that changes transcription settings and its results go in the PR.

### 3. End to end

- **Web.** Playwright launches Chromium with `--use-fake-device-for-media-stream --use-file-for-fake-audio-capture=<clip>.wav` against the dev server in cassette mode, so the real `getUserMedia`, worklet, and socket run. `app-web/e2e/ramble.e2e.ts` covers desktop flows. WebKit cannot inject audio, so the `parity` project's Ramble tests use a test-only audio source flag in the dev build that streams the fixture's PCM in place of the mic.
- **iOS.** A DEBUG launch key `PROCRASTIMATE_RAMBLE_FIXTURE=<id>` makes the capture layer read the fixture's PCM instead of the mic, against the dev server in cassette mode, so XCUITests drive the real socket and UI. Release builds ignore it.
- **Server.** `server/src/account/ramble.test.ts` covers auth, caps, keyterm selection and truncation, the stop and final-commit path, the `503` without a key, and upstream errors, against a fake upstream.

### 4. Paired parity tests

Each UI row has one Playwright test in `app-web/e2e/parity/ramble.e2e.ts` and one XCUITest in `RambleParityTests.swift`, both from the same fixture and pinned clock, asserting the same names and strings. The ids are fixed now so the web and iOS slices build them in parallel:

| Parity id            | Scenario                                                                               |
| -------------------- | -------------------------------------------------------------------------------------- |
| `ramble-open`        | Mic in quick add opens Ramble; long-press on the add button opens it listening         |
| `ramble-live`        | Fixture `three-tasks` streams; the transcript and three cards appear before stop       |
| `ramble-chips`       | Fixture `metadata` yields project, label, date, repeat, priority, and reminder chips   |
| `ramble-subtasks`    | Fixture `party-subtasks` yields one parent with three indented subtasks                |
| `ramble-notes`       | Fixture `paint-note` puts the note under the title                                     |
| `ramble-plain`       | Fixture `no-metadata` yields chip-free cards                                           |
| `ramble-edit`        | Tapping a card edits its title and changes its date with the picker                    |
| `ramble-discard`     | Discarding a card removes it, and `Undo` brings it back                                |
| `ramble-save-undo`   | `Add 3 tasks` saves into the list; the toast's `Undo` removes all three                |
| `ramble-hold`        | Hold to talk listens while held and stops on release                                   |
| `ramble-unavailable` | Unpaired shows `Turn on sync to use Ramble`; offline shows `Ramble needs a connection` |

## Cost and free-tier fit

Per minute of rambling:

| Item                                | Cost per minute    | Notes                                                                                                                   |
| ----------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Scribe v2 Realtime                  | $0.0065            | $0.39 per hour                                                                                                          |
| Keyterms (realtime)                 | $0.0013            | $0.08 per hour in ElevenLabs' realtime table; the FAQ says $0.05                                                        |
| Worker and Durable Object           | $0                 | 1 upgrade request plus about 600 incoming frames, billed as 30 requests at 20:1; 7.5 GB-s of duration                   |
| LLM segmentation (only if R7 ships) | about $0 to $0.001 | One call per session of about 1,700 input and 300 output tokens: about 106 Workers AI neurons, free within 10,000 a day |
| **Total**                           | **about $0.008**   | **under half a dollar an hour**                                                                                         |

Free-tier fit:

- **ElevenLabs.** The free plan includes about 2 h 30 min of Scribe v2 Realtime a month, about $1 of usage, or about 2 hours with keyterms. Starter ($6 a month) includes about 15 hours. At 5 minutes of rambling a day (2.5 hours a month), Stefan fits the free plan only barely and Starter comfortably. ([API pricing](https://elevenlabs.io/pricing/api))
- **Cloudflare Workers Free.** 100,000 requests a day, 13,000 GB-s of Durable Object duration a day, and 10 ms CPU per Worker request; the Durable Object's per-message CPU reset is why the proxy lives there. Even an hour of rambling a day uses about 1,800 billed requests and 450 GB-s. ([Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/))
- **Workers AI** (if R7 ships). 10,000 neurons a day free covers about 90 segmentation calls a day.

## Plan and slices

One PR per slice, each off `master`, never stacked. A slice starts once the slices it depends on have merged. Each slice owns its files, its rows in the feature map (`.cursor/skills/verify-procrastimate/features/ramble.md`) and in [iOS parity](ios-parity.md#ramble), and updates [Ramble](decisions/ramble.md) when it settles a decision.

| Slice | Thread                                  | Depends on | Runs in parallel with |
| ----- | --------------------------------------- | ---------- | --------------------- |
| R1    | Transcription proxy                     | —          | R2                    |
| R2    | Spoken grammar and corpus (TS)          | —          | R1                    |
| R3    | Swift port of the grammar               | R2         | R1, R4                |
| R4    | Web Ramble (capture, sheet, Playwright) | R1, R2     | R3, R5, R6            |
| R5    | iOS Ramble (capture, sheet, XCUITests)  | R1, R3     | R4, R6                |
| R6    | Audio fixtures, cassettes, live check   | R1         | R3, R4, R5            |
| R7    | LLM segmentation (conditional)          | R2, R4, R5 | —                     |

R1 and R2 start at once and share no files. R4 and R5 are the web and iOS twins and run side by side against the parity ids above; each lands its half of every pair, and a pair's iOS row reads `Built` once both halves are green. R4 and R5 start on a hand-made cassette from R1 and swap in R6's recorded ones when they land.

- **R1: Transcription proxy.** `GET /api/ramble/socket` on the `Account` object: device auth by subprotocol or header, the outbound ElevenLabs socket with the session settings above, keyterms from synced names, the 5 minute session and 60 minute daily caps, the final commit on stop, the `503` without a key. `shared/ramble/protocol.ts` with zod. The dev server's `SocketHost` path, the cassette fake upstream, and `RAMBLE_UPSTREAM`. The optional `ELEVENLABS_API_KEY` server-target entry in the env-manager schema and the secret note in [Production hosting](decisions/production-hosting.md). Measures the latencies on the deployed Worker and records them. Owns `server/src/account/ramble.ts`, its test, its route line, and `shared/ramble/protocol.ts`.
- **R2: Spoken grammar and corpus.** `shared/ramble.ts` (`parseRamble`) with normalize, segment, attributes, and assemble; the `spoken` option in `shared/quick-add.ts` with its tests and refreshed `quick-add.json` vectors; `shared/fixtures/ramble-corpus.ts`, the generator, `shared/ramble.test.ts` with the scorer and the provenance gate; `shared/vectors/ramble.json`. Reports the scorer summary in the PR. Owns those files.
- **R3: Swift port.** `Core/Ramble.swift` porting `parseRamble`, plus the `spoken` option in `QuickAdd.parse`, with `VectorTests` passing on `ramble.json` and the refreshed `quick-add.json`. Owns `app-ios/Sources/Core/Ramble*.swift` and the vector test hook.
- **R4: Web Ramble.** The `AudioWorklet` capture, the socket client with the subprotocol token, the Ramble sheet (transcript, preview cards, per-task edit and discard, hold to talk, save and undo), the entry points, the error states, `app-web/e2e/ramble.e2e.ts` on desktop with fake audio, and the web half of every `ramble-*` parity pair. Owns `app-web/src/lib/ramble/**`, the Ramble components, the quick add mic button, and the e2e files.
- **R5: iOS Ramble.** `AVAudioEngine` capture, the `URLSessionWebSocketTask` client with the Keychain token, `Screens/Ramble/`, the quick add mic button, the add button long-press, haptics, the `PROCRASTIMATE_RAMBLE_FIXTURE` launch key, and the iOS half of every `ramble-*` parity pair. Owns `app-ios/Sources/App/Screens/Ramble/**`, its capture files, and `RambleParityTests.swift`.
- **R6: Audio fixtures and live check.** The clips (generated or recorded as decided below), the manifest, the cassettes recorded through the deployed proxy, `bun run ramble:live` with word error rate and latency output. Owns `shared/fixtures/ramble-audio/**` and the script.
- **R7: LLM segmentation.** Only if R2's natural-ramble task-count score stays under 90% after tuning. The `AI` binding, `POST /api/ramble/segment` with the sentence-grouping schema and validation, the shared `applyGrouping` with vectors and its Swift port, and the settle animation on both clients. One slice for both clients, since the logic is server-side and shared.

## Decisions for Stefan

Stefan accepted all eight recommendations; they are recorded in [Ramble](decisions/ramble.md).

1. **Ramble requires a paired device.** Recommended, because each minute costs money and the sync token is the only device credential. The alternative is an open endpoint protected only by caps.
2. **LLM at all, and which.** Recommended: no LLM until the corpus proves it is needed (R7), then Workers AI Llama 3.3 70B, which needs no new key. Say if you would rather allow Gemini Flash-Lite (needs a `GEMINI_API_KEY` secret) or never use an LLM.
3. **English only.** Recommended: pin `language_code=en`. Auto-detect is a one-line change if you ramble in other languages; the grammar would then still find no metadata in them.
4. **"That's all" stops but does not save.** Todoist saves on it. Recommended: stop only, so a stray phrase never adds tasks.
5. **Caps.** 5 minutes per session and 60 minutes per day. Change either if they feel tight.
6. **ElevenLabs plan.** The free plan's about 2 hours of realtime a month fits light use; Starter ($6 a month, about 15 hours) if you ramble daily.
7. **Audio fixtures.** Your key seems scoped to speech to text, so TTS may fail. Pick one: a TTS-scoped key used once on your machine, offline Piper voices, or about 10 short recordings in your own voice (most realistic).
8. **Spoken priority words.** Recommended: in speech only `priority one` to `four` and `p1` to `p4` set priority; `urgent` and `important` stay words.
