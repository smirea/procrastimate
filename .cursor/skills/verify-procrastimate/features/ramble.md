# Ramble

Ramble lets Stefan talk his tasks in. An empty quick add textbox shows a mic on its right; tapping it swaps quick add for a fullscreen drawer that is already listening. A waveform of the real mic level pulses above the stop button. Tasks rise into the list as they are recognized, with their subtasks and their date, repeat, reminder, priority, project, and label chips, and the end of the transcript shows above the waveform with each recognized phrase tinted. After stop (and, on iOS, Apple's on-device model picking the structure), every title is editable, each task opens its pickers, each task and subtask has a remove button, the mic keeps talking to append more, and `Add N tasks` saves them all. Web and iOS both have it. The design is in `docs/ramble-design.md` and the decisions in `docs/decisions/ramble.md`.

## Sub-features

- `ramble-mic` shows a mic on the right of an empty quick-add textbox. It opens the drawer, listening, with quick add's list defaults.
- `ramble-wave` draws capsule bars from the real mic level, newest in the middle, rippling outward, settling to dots at rest.
- `ramble-live` adds tasks, subtasks, and field chips as the grammar recognizes them, and shows the transcript tail with metadata tinted and spoken commands faded. Before the first task, three example rambles show.
- `ramble-structure` (iOS) runs the on-device model after stop, with `Sorting the ramble` in the header, to decide which to-dos the speaker meant and which items belong under each. Spoken commands, a failed or slow model, or an answer the transcript does not back leave the grammar's tasks.
- `ramble-review` makes every title editable after stop. Tapping a task opens its date, priority, labels, and project pickers, and its repeat and reminders as chips that remove themselves. Each task and subtask has `Remove <title>`. The mic (`Keep talking`) appends a new capture.
- `ramble-save` saves every task with its subtasks and notes from `Add task` or `Add N tasks`, shows the first in its list, and toasts `Added N tasks`. With nothing heard, `Type instead` reopens quick add.
- `ramble-corrections` keeps only the corrected phrase: `Thursday actually make that Friday`, `the 20th, I mean the 21st`, `tomorrow at 3pm sorry 4pm`.
- `ramble-unavailable` explains why the ElevenLabs path is off when its key is missing or the socket is refused. Offline dictation uses the platform recognizer, with no extra banner.
- `ramble-fallback` (web) moves to the ElevenLabs socket when native dictation fails before hearing anything while online, as in Brave, which exposes `SpeechRecognition` but errors at once. A native stop on error or no support shows `Dictation stopped. You can type the task instead.`

## How to get to it (user POV)

- Web and iOS: tap Add, then the mic inside the empty textbox.
- Web keys in the drawer: Escape stops listening, then closes an open editor, then closes the drawer. Space toggles listening and Enter saves when no field has focus.
- iOS: "Start Ramble in ProcrastiMate" from Siri or Shortcuts opens the drawer listening. The DEBUG launch word `PROCRASTIMATE_DEMO=ramble` does the same in the simulator.

## Driving it with control-ui and the simulator

- Native dictation on iOS is `SpeechAnalyzer`, on the device. The simulator has neither a microphone nor the speech model, so use the script below; on a device, a DEBUG build launched from Xcode with the `PROCRASTIMATE_RAMBLE_AUDIO` environment variable set to a spoken audio file streams that file through the real analyzer.
- iOS simulator, which has no microphone: launch with `SIMCTL_CHILD_PROCRASTIMATE_RAMBLE_SCRIPT="<words>"`, tap `Quick add`, then `Ramble`. The script arrives a word at a time, and the waveform moves with a made-up level per word. Say `buy groceries for the party, milk, eggs and bread. Plan the trip to Lisbon, the steps are book flights, find a hotel and rent a car. Oh and call mom tomorrow at 5pm actually make that 6pm`: the list fills live, `Plan the trip to Lisbon` gets three subtasks, and after `Stop listening` it shows `Add 3 tasks` with `Call mom` on `Tomorrow 6pm`. Without taps, launch with `SIMCTL_CHILD_PROCRASTIMATE_INTENTS=ramble` and end the script with `That's all.`: the drawer opens listening and stops on its own. On the iOS 27 simulator the model runs: `Go to the supermarket at 6pm and there get squid, garlic and some mayo. And then I also need to call the vet tomorrow at 9am. That's all.` ends as `Go to the supermarket` (`Today 6pm`) with `Squid`, `Garlic`, `Mayo`, and `Call the vet` (`Tomorrow 9am`). A model failure logs `Ramble model split failed` under the `errors` category. Say `call the dentist tomorrow at 3pm sorry 4pm priority 2`: the drawer shows `Call the dentist` with `Tomorrow 4pm` and `P2`.

- On a paired device, open the drawer and say "Call mom tomorrow at 5pm priority one." The bars move with your voice, `Call mom` arrives with `Tomorrow 5pm` and `P1` chips. Stop, then `Add task` saves that one task.
- Say "Finish the project report" with no project named `report`. The task keeps that title and no extra chips.
- With Dictation set to ElevenLabs and no key, or a refused socket, the drawer says Ramble needs a connection. Offline, or Dictation set to Native, uses the platform recognizer and does not open the socket.
- In Brave online with Dictation set to Native, tap the mic. Recognition fails at once and capture moves to the ElevenLabs socket, so the mic keeps listening.
- On iOS, tap just beside the mic glyph. The mic's whole rectangle is its hit area and the card has a content shape, so the tap opens the drawer instead of reaching the scrim.
- Web: `app-web/e2e/ramble.e2e.ts` grants a fake microphone, names the `party` cassette on the socket URL, and drives streaming, editing, removing, saving, and Escape. The fake mic's beep drives the bars.

## Parser

`parseRamble` in `shared/ramble.ts` turns a transcript into tasks. `Ramble.structured` in `Core/RambleStructure.swift` applies the on-device model's split on iOS behind transcript guards, and `Ramble.newTask` saves a spoken task with the list defaults (`RambleStructureTests`). `app-ios/Evals/RambleModel` scores the grammar and the model split on labelled rambles. `rambleNewTask` in `shared/ramble-fill.ts` is the web's `Ramble.newTask`. The drawer keys parsed tasks by position (`keyed` in `app-web/src/lib/ramble/entries.ts`, `RambleEntry.keyed` in Swift) so rows survive reparsing. The corpus is in `shared/ramble.test.ts`; locked cases are recorded in `shared/vectors/ramble.json`. The Swift port is `Core/Ramble.swift`. Linux `VectorTests` runs the grammar cases. Spoken mode is in the Swift quick add parser.

## Gotchas

- ElevenLabs needs the network and the key. Native dictation is the platform recognizer and works offline. The grammar is local. The choice syncs with the other settings.
- The transcription socket is `GET /api/ramble/socket` on a signed-in device. The web sends the session cookie and `device.<id>` as a subprotocol, like sync. iOS sends `Authorization: Bearer`, the `procrastimate.ramble` subprotocol, and `x-procrastimate-device`.
- Two cassettes exist: `three-tasks` (the default) and `party` (a list with subtasks, a time, a priority, and a reminder). "That's all" stops listening and does not save. Closing the drawer discards the ramble.
- `Evals/RambleModel` in `app-ios/` is a macOS package that scores the grammar and the model split on labelled rambles (`swift run -c release eval -v dev.json grammar split`; also `structure.json`, and `holdout.json` only for a final check) and lists corpus vectors the split changes (`eval -v corpus split`). It needs Apple Intelligence on the Mac.
- App Shortcuts keep ten phrases. Start Ramble took the slot Delete All Data had. The delete intent is still there.
