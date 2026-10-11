# Ramble

Ramble lets Stefan talk instead of type: a live transcript and a preview card per task grow as he speaks, and he edits or discards cards before adding them all at once. It is planned for web and iOS together; the design is in `docs/ramble-design.md` and the decisions in `docs/decisions/ramble.md`.

## Sub-features

- `ramble-open` opens Ramble from the quick add mic button, a long-press on the add button, or `Shift+Q`.
- `ramble-live` shows the transcript and task cards while Stefan talks.
- `ramble-chips` shows spoken project, labels, date, repeat, priority, and reminders as chips, and nothing that was not said.
- `ramble-subtasks` nests spoken subtasks under their parent.
- `ramble-notes` puts a spoken note under the title.
- `ramble-plain` leaves a ramble without metadata chip-free.
- `ramble-edit` edits a card before saving.
- `ramble-discard` discards a card, with `Undo`.
- `ramble-save-undo` adds every card in one step, undone by one `Undo`.
- `ramble-hold` listens only while the mic is held.
- `ramble-unavailable` explains why Ramble is off when unpaired or offline.

## How to get to it (user POV)

- Planned: web and iOS, tap the mic at the end of the quick add input, or long-press the floating add button.
- Planned: web desktop and iPad with a hardware keyboard, press `Shift+Q`.

## Driving it with control-ui and XCUITest

- Planned: on a paired device, open Ramble and say "Buy paint. Note the blue one. Next task call mom tomorrow at 5pm priority one." Two cards appear while talking: `Buy paint` with the note, and `Call mom` with `Tomorrow 5:00 PM` and `Priority 1` chips. `Add 2 tasks` saves both, and the toast's `Undo` removes both.
- Planned: say "Finish the project report" with no project named `report`. One chip-free card titled `Finish the project report` appears.
- Planned: on an unpaired device the mic reads `Turn on sync to use Ramble`.

## Parser

`parseRamble` in `shared/ramble.ts` turns a transcript into tasks locally, on every partial. It reuses quick add's parser in `spoken` mode. The corpus, provenance gate, and score are in `shared/ramble.test.ts`; locked cases are recorded in `shared/vectors/ramble.json` for the Swift port. Linux `VectorTests` leaves that module pending until R3. Spoken mode is already in the Swift quick add parser.

## Gotchas

- Transcription needs the network and a paired device; everything else about the preview is local.
- Automated tests replay recorded transcription cassettes, so they never need the ElevenLabs key.
- The transcription socket is built: `GET /api/ramble/socket` on a paired device. The Bun dev server without `ELEVENLABS_API_KEY`, and any server with `RAMBLE_UPSTREAM=cassette`, replays `shared/fixtures/ramble-audio/three-tasks.cassette.json` (or `?cassette=<id>`) from the first audio frame, and a `stop` plays the rest at once.
- `bun server/scripts/ramble-latency.ts --url <origin>` streams real speech through the socket and prints latencies; with `SYNC_SETUP_CODE` it pairs a temporary device and removes it afterwards.
