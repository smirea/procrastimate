# Search

Search lets Stefan find any task, project, or label from anywhere by typing a few letters. Results update on every keystroke, highlight what matched, group projects, labels, open tasks, and completed tasks, and open with a click, a tap, or the keyboard.

## Sub-features

- `search-open` opens search with `/`, Cmd-K or Ctrl-K, or the `Search` button in the sidebar or phone drawer, always with an empty field. Shortcuts never fire while typing in a field. On iOS, switching to Browse from another tab or pressing Cmd-K empties the field; Back from a result keeps it.
- `search-match` matches task titles, notes, project names, and label names, ignoring case and accents. Every word of the query must match somewhere.
- `search-rank` puts title matches above project and label matches above notes matches, and matches at the start of a word above matches inside one.
- `search-highlight` highlights every matched span in titles, notes excerpts, project names, label names, and the label chips of matching tasks.
- `search-keyboard` moves the selection with Up and Down, opens it with Enter, and closes with Escape or Cmd-K or Ctrl-K again.
- `search-open-result` opens a task in task details, or navigates to a project or a label view.
- `search-completed` lists matching completed tasks in their own `Completed` group after open tasks, struck through with their completion date. Task details reopen one with `Reopen`.
- `search-empty` reads `No results for “<query>”` when nothing matches.

## How to get to it (user POV)

- Web: press `/` or Cmd-K or Ctrl-K anywhere outside a text field.
- Web: choose `Search` under `Add task` in the sidebar.
- Web on a phone: tap `Open navigation`, then `Search`. The sheet docks at the bottom with the field under the results, above the keyboard.
- iOS: open the Browse tab and tap the `Search` field at its top. Typing replaces the Browse list with results. With a hardware keyboard, Cmd-K opens Browse with the field focused. The DEBUG launch word `PROCRASTIMATE_DEMO=search` does the same.

## Driving it with control-ui and the simulator

Preconditions:

- The baseline state. Create project `Home`, return to Inbox, then add `Fix sink #Home p2`, `Water plants tomorrow`, `Call plumber`, and `Buy milk` through quick add. Give `Call plumber` the notes `Ask about the home warranty`.
- Unit proof for the matching rules: `bun test shared/search.test.ts shared/name-search.test.ts`.

- **Shortcuts.** Press `/`; the `Search` dialog opens with its field focused. Escape closes it. Cmd-K or Ctrl-K opens it and pressing it again closes it. In quick add, type `Read 1/2 of book` and press Cmd-K or Ctrl-K; the text stays and search does not open.
- **Match and highlight.** Type `home`. `Projects` lists `Home`. `Tasks` lists `Fix sink` with `# Home`, then `Call plumber` with the notes excerpt `Ask about the home warranty`. Each `home` is highlighted, and `Home` is selected. Press Down twice and Enter; task details open on `Call plumber`.
- **Every word.** Type `sink home`; only `Fix sink` is listed. Type `sink garden`; the list reads `No results for “sink garden”`.
- **Project.** Type `hom` and press Enter. The `Home` project opens and search closes.
- **Completed.** Add `Renew passport` and `Passport photos`, complete `Renew passport`, and search `passport`. `Tasks` lists `Passport photos` and `Completed` lists `Renew passport` with `Completed Today`. Open it, choose `Reopen`, and close; Inbox lists both again.
- **Labels.** Create labels `calls` and `waiting`, then add `Plumber @calls`, `Dentist @waiting @calls`, and `Read a book`. Search `call`. `Labels` lists `calls`, selected. `Tasks` lists `Plumber` and `Dentist`, each with a `calls` chip whose `call` is highlighted. Search `dentist waiting`; only `Dentist` is listed. Search `wait` and press Enter; search closes and the `waiting` label view lists `Dentist`. Unit test for the matching: `a label name matches its tasks and the label itself` in `shared/search.test.ts`.
- **Phone.** Add `Fix sink p2`, `Water plants tomorrow`, and `Call plumber`. Tap `Open navigation`, then `Search`; the drawer closes and the field is focused. With the keyboard open, type `pl`. The results sit above the field and the sheet sits above the keyboard, fully on screen. `Water plants` and `Call plumber` are listed with `pl` highlighted. Tap `Water plants`; task details open on it.
- **Phone label.** With label `calls` on `Call plumber`, open search from the drawer and type `cal`. `Labels` lists `calls`. Tap it; the `calls` view lists `Call plumber`.
- **iOS.** Create `Home` and add `Fix sink p2` inside it, then add `Water plants tomorrow`, `Call plumber`, `Buy milk`, and `Update résumé` in Inbox (quick add cannot set notes, so the iOS pair skips the notes match). Return after a trailing `#Home` or `@calls` picks the open suggestion rather than saving, so the seeds put tags first or add inside the project. Search `home`: `Home` is listed above `Fix sink`. `sink home` lists only `Fix sink`, `resume` finds `Update résumé`, and `sink garden` reads `No results for “sink garden”`. `hom` plus Return opens `Home`. Tapping a task opens task details, and a project or label pushes its screen onto Browse's stack, with Back returning to the results. The Search App Intent opens Browse with its query in the field. Searching `call` lists the `calls` label and both labeled tasks; each result's accessibility value reads its matched spans, such as `Matches call`. A completed `Renew passport` lists under `Completed` with `Completed Today`, below `Passport photos`, and its leading swipe `Reopen`, or `Reopen` in its task details, brings it back to Inbox. A subtask `Passport` of `Pack for trip` is found by its own text, reads `Subtask of Pack for trip`, and opens its details with `Back to Pack for trip`. The matching, ranking, highlights, excerpts, and `#` and `@` suggestion order are already in `Core`: `swift test` in `app-ios/` replays `shared/vectors/search.json` and `name-search.json` in `VectorTests`.

## Gotchas

- Quick add defaults to the open project. Return to Inbox before seeding, or every seeded task lands in `Home`.
- A single letter matches only at the start of a word, so `i` does not match `milk`.
- Search shows the best 5 projects, 5 labels, 30 open tasks, and 15 completed tasks. Each group header shows the full count.
- On a phone, scrolling the results dismisses the keyboard.
- An empty field on reopening is the expected state, not a lost query. Test: `search opens with an empty query each time` in `e2e/inputs.e2e.ts`.
- Headless WebKit on Linux does not draw the sheet's backdrop blur, so content behind the phone sheet looks sharper in its screenshots than on a real iPhone.
