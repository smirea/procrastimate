# Ramble

Ramble lets Stefan talk into quick add. After Add, the textbox shows a mic on its right. The mic hides once he types. Tapping it records, the icon becomes stop, and the live transcript fills the textbox. On stop, the grammar replaces that transcript with the parsed title and fills the same chips quick add uses for a date, project, labels, priority, repeat, and reminders. Web and iOS both have it. The design is in `docs/ramble-design.md` and the decisions in `docs/decisions/ramble.md`.

## Sub-features

- `ramble-mic` shows a mic on the right of the quick-add textbox after Add, and hides it once Stefan types.
- `ramble-live` turns the mic into stop, and fills the textbox with the transcript while he talks.
- `ramble-parse` replaces the transcript on stop with the parsed title, and fills the chips the way quick add does.
- `ramble-unavailable` explains why the ElevenLabs path is off when its key is missing or the socket is refused. Offline dictation uses the platform recognizer, with no extra banner.
- `ramble-fallback` (web) moves to the ElevenLabs socket when native dictation fails before hearing anything while online, as in Brave, which exposes `SpeechRecognition` but errors at once. A native stop on error or no support shows `Dictation stopped. You can type the task instead.`

## How to get to it (user POV)

- Web and iOS: tap Add, then the mic inside the textbox.
- iOS: "Start Ramble in Procrastinate" from Siri or Shortcuts opens quick add and starts the mic. The DEBUG launch word `PROCRASTIMATE_DEMO=ramble` does the same in the simulator.

## Driving it with control-ui and XCUITest

- On a paired device, open quick add and say "Call mom tomorrow at 5pm priority one." The textbox shows the words while talking. Stop, and the textbox shows `Call mom` with a tomorrow chip and `Priority 1`. Add task saves that one task.
- Say "Finish the project report" with no project named `report`. Stop leaves that title and no extra chips.
- With Dictation set to ElevenLabs and no key, or a refused socket, quick add says Ramble needs a connection. Offline, or Dictation set to Native, uses the platform recognizer and does not open the socket.
- In Brave online with Dictation set to Native, tap the mic. Recognition fails at once and capture moves to the ElevenLabs socket, so the mic keeps listening.
- On iOS, tap just beside the mic glyph. The mic's whole rectangle is its hit area and the card has a content shape, so the tap never reaches the scrim and quick add stays open.

## Parser

`parseRamble` in `shared/ramble.ts` turns a transcript into tasks. `quickAddFromRamble` in `shared/ramble-fill.ts` turns that into one quick-add field: one task keeps its title and metadata, and several tasks become one title with the chips left at the list defaults. The corpus is in `shared/ramble.test.ts`; locked cases are recorded in `shared/vectors/ramble.json`. The Swift port is `Core/Ramble.swift` and `Core/RambleFill.swift`. Linux `VectorTests` runs the grammar cases, and `RambleFillTests` covers the field. Spoken mode is in the Swift quick add parser.

## Gotchas

- ElevenLabs needs the network and the key. Native dictation is the platform recognizer and works offline. The grammar is local. The choice syncs with the other settings.
- The transcription socket is `GET /api/ramble/socket` on a signed-in device. The web sends the session cookie and `device.<id>` as a subprotocol, like sync. iOS sends `Authorization: Bearer`.
- Cassettes and the optional LLM segmentation are not built. "That's all" stops listening and does not save. Notes and subtasks are not shown in the field.
- App Shortcuts keep ten phrases. Start Ramble took the slot Delete All Data had. The delete intent is still there.
