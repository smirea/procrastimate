# Ramble

Ramble lets Stefan talk into quick add. After Add, the textbox shows a mic on its right. The mic hides once he types. Tapping it records, the icon becomes stop, and the live transcript fills the textbox. On the web, stop replaces that transcript with the parsed title and fills the same chips quick add uses for a date, project, labels, priority, repeat, and reminders. On iOS the spoken tasks show live under the textbox with their subtasks and fields, Apple's on-device model splits them into tasks and listed items on stop, and one plain task fills the field while anything more stays as a list to save together. Web and iOS both have it. The design is in `docs/ramble-design.md` and the decisions in `docs/decisions/ramble.md`.

## Sub-features

- `ramble-mic` shows a mic on the right of the quick-add textbox after Add, and hides it once Stefan types.
- `ramble-live` turns the mic into stop, and fills the textbox with the transcript while he talks.
- `ramble-parse` replaces the transcript on stop with the parsed title, and fills the chips the way quick add does, when the ramble is one plain task.
- `ramble-live` (iOS) lists the spoken tasks, subtasks, dates, priority, project, labels, and reminders under the textbox while Stefan talks.
- `ramble-list` (iOS) keeps several tasks, or a task with subtasks or notes, as a list after stop. Each task and subtask has a remove button, and `Add N tasks` saves them all with their subtasks and notes.
- `ramble-structure` (iOS) runs the on-device model after stop, with a spinner, to decide which to-dos the speaker meant and which items belong under each. Spoken commands, a failed or slow model, or an answer the transcript does not back leave the grammar's tasks.
- `ramble-corrections` keeps only the corrected phrase: `Thursday actually make that Friday`, `the 20th, I mean the 21st`, `tomorrow at 3pm sorry 4pm`.
- `ramble-unavailable` explains why the ElevenLabs path is off when its key is missing or the socket is refused. Offline dictation uses the platform recognizer, with no extra banner.
- `ramble-fallback` (web) moves to the ElevenLabs socket when native dictation fails before hearing anything while online, as in Brave, which exposes `SpeechRecognition` but errors at once. A native stop on error or no support shows `Dictation stopped. You can type the task instead.`

## How to get to it (user POV)

- Web and iOS: tap Add, then the mic inside the textbox.
- iOS: "Start Ramble in ProcrastiMate" from Siri or Shortcuts opens quick add and starts the mic. The DEBUG launch word `PROCRASTIMATE_DEMO=ramble` does the same in the simulator.

## Driving it with control-ui and XCUITest

- Native dictation on iOS is `SpeechAnalyzer`, on the device. The simulator has neither a microphone nor the speech model, so use the script below; on a device, a DEBUG build launched from Xcode with the `PROCRASTIMATE_RAMBLE_AUDIO` environment variable set to a spoken audio file streams that file through the real analyzer.
- iOS simulator, which has no microphone: launch with `SIMCTL_CHILD_PROCRASTIMATE_RAMBLE_SCRIPT="<words>"` (or the XCUITest `launchEnvironment`), tap `Quick add`, then `Ramble`. The script arrives a word at a time. Say `buy groceries for the party, milk, eggs and bread. Plan the trip to Lisbon, the steps are book flights, find a hotel and rent a car. Oh and call mom tomorrow at 5pm actually make that 6pm`: the list fills live, `Plan the trip to Lisbon` gets three subtasks, and after `Stop listening` it shows `Add 3 tasks` with `Call mom` on `Tomorrow 6pm`. Without taps, launch with `SIMCTL_CHILD_PROCRASTIMATE_INTENTS=ramble` and end the script with `That's all.`: quick add opens listening and applies on its own. On the iOS 27 simulator the model runs: `Go to the supermarket at 6pm and there get squid, garlic and some mayo. And then I also need to call the vet tomorrow at 9am. That's all.` ends as `Go to the supermarket` (`Today 6pm`) with `Squid`, `Garlic`, `Mayo`, and `Call the vet` (`Tomorrow 9am`). A model failure logs `Ramble model split failed` under the `errors` category. Say `call the dentist tomorrow at 3pm sorry 4pm priority 2`: stop fills the field with `Call the dentist`, `Tomorrow 4pm`, and the P2 flag.

- On a paired device, open quick add and say "Call mom tomorrow at 5pm priority one." The textbox shows the words while talking. Stop, and the textbox shows `Call mom` with a tomorrow chip and `Priority 1`. Add task saves that one task.
- Say "Finish the project report" with no project named `report`. Stop leaves that title and no extra chips.
- With Dictation set to ElevenLabs and no key, or a refused socket, quick add says Ramble needs a connection. Offline, or Dictation set to Native, uses the platform recognizer and does not open the socket.
- In Brave online with Dictation set to Native, tap the mic. Recognition fails at once and capture moves to the ElevenLabs socket, so the mic keeps listening.
- On iOS, tap just beside the mic glyph. The mic's whole rectangle is its hit area and the card has a content shape, so the tap never reaches the scrim and quick add stays open.

## Parser

`parseRamble` in `shared/ramble.ts` turns a transcript into tasks. `Ramble.structured` in `Core/RambleStructure.swift` applies the on-device model's split on iOS behind transcript guards, and `Ramble.newTask` saves a spoken task with the list defaults (`RambleStructureTests`). `app-ios/Evals/RambleModel` scores the grammar and the model split on labelled rambles. `quickAddFromRamble` in `shared/ramble-fill.ts` turns a draft into one quick-add field: one task keeps its title and metadata, and several tasks become one title with the chips left at the list defaults. The corpus is in `shared/ramble.test.ts`; locked cases are recorded in `shared/vectors/ramble.json`. The Swift port is `Core/Ramble.swift` and `Core/RambleFill.swift`. Linux `VectorTests` runs the grammar cases, and `RambleFillTests` covers the field. Spoken mode is in the Swift quick add parser.

## Gotchas

- ElevenLabs needs the network and the key. Native dictation is the platform recognizer and works offline. The grammar is local. The choice syncs with the other settings.
- The transcription socket is `GET /api/ramble/socket` on a signed-in device. The web sends the session cookie and `device.<id>` as a subprotocol, like sync. iOS sends `Authorization: Bearer`, the `procrastimate.ramble` subprotocol, and `x-procrastimate-device`.
- One cassette exists (`three-tasks`). "That's all" stops listening and does not save. On the web, notes and subtasks are not shown in the field.
- `Evals/RambleModel` in `app-ios/` is a macOS package that scores the grammar and the model split on labelled rambles (`swift run -c release eval -v dev.json grammar split`; also `structure.json`, and `holdout.json` only for a final check) and lists corpus vectors the split changes (`eval -v corpus split`). It needs Apple Intelligence on the Mac.
- App Shortcuts keep ten phrases. Start Ramble took the slot Delete All Data had. The delete intent is still there.
