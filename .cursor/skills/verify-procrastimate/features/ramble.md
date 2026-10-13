# Ramble

Ramble lets Stefan talk instead of type: a live transcript and a preview card per task grow as he speaks, and he edits or discards cards before adding them all at once. Web and iOS both have it. The design is in `docs/ramble-design.md` and the decisions in `docs/decisions/ramble.md`.

## Sub-features

- `ramble-open` opens Ramble from the quick add mic, a long-press on the add button, or `Shift+Q`.
- `ramble-live` shows the transcript and task cards while Stefan talks.
- `ramble-chips` shows spoken project, labels, date, repeat, priority, and reminders as chips, and nothing that was not said.
- `ramble-subtasks` nests spoken subtasks under their parent.
- `ramble-notes` puts a spoken note under the title.
- `ramble-plain` leaves a ramble without metadata chip-free.
- `ramble-edit` edits a card's title, notes, and date before saving. An edit pins the card.
- `ramble-discard` discards a card, with `Undo`.
- `ramble-save-undo` adds every card in one step, undone by one `Undo`.
- `ramble-hold` listens only while the mic, or the add button, is held.
- `ramble-unavailable` explains why the ElevenLabs path is off when its key is missing or the socket is refused. Offline dictation uses the platform recognizer, with no extra banner.

## How to get to it (user POV)

- Web and iOS: tap the mic at the end of the quick add input, or long-press the floating add button. A plain tap of the add button still opens quick add.
- Web desktop and iPad with a hardware keyboard: press `Shift+Q`.
- iOS: "Start Ramble in Procrastimate" from Siri or Shortcuts.

## Driving it with control-ui and XCUITest

- On a paired device, open Ramble and say "Buy paint. Note the blue one. Next task call mom tomorrow at 5pm priority one." Two cards appear while talking: `Buy paint` with the note, and `Call mom` with a tomorrow chip and `Priority 1`. `Add 2 tasks` saves both, and the toast's `Undo` removes both.
- Say "Finish the project report" with no project named `report`. One chip-free card titled `Finish the project report` appears.
- With Dictation set to ElevenLabs and no key, or a refused socket, the sheet says Ramble needs a connection. Offline, or Dictation set to Native, uses the platform recognizer and does not open the socket.

## Parser

`parseRamble` in `shared/ramble.ts` turns a transcript into tasks locally, on every partial. It reuses quick add's parser in `spoken` mode. The corpus, provenance gate, and score are in `shared/ramble.test.ts`; locked cases are recorded in `shared/vectors/ramble.json`. The Swift port is `Core/Ramble.swift`, and Linux `VectorTests` runs those cases. Spoken mode is in the Swift quick add parser.

## Gotchas

- ElevenLabs needs the network and the key. Native dictation is the platform recognizer and works offline. The preview grammar is local. The choice syncs with the other settings.
- The transcription socket is `GET /api/ramble/socket` on a signed-in device. The web sends the session cookie and `device.<id>` as a subprotocol, like sync. iOS sends `Authorization: Bearer`.
- Cassettes and the optional LLM segmentation are not built. "That's all" stops listening and does not save.
- App Shortcuts keep ten phrases. Start Ramble took the slot Delete All Data had. The delete intent is still there.
