# Search

Search lets Stefan find any task or project from anywhere by typing a few letters. Results update on every keystroke, highlight what matched, group projects, open tasks, and completed tasks, and open with a click, a tap, or the keyboard.

## Sub-features

- `search-open` opens search with `/`, Cmd-K or Ctrl-K, or the `Search` button in the sidebar or phone drawer. Shortcuts never fire while typing in a field.
- `search-match` matches task titles, notes, and project names, ignoring case and accents. Every word of the query must match somewhere.
- `search-rank` puts title matches above project matches above notes matches, and matches at the start of a word above matches inside one.
- `search-highlight` highlights every matched span in titles, notes excerpts, and project names.
- `search-keyboard` moves the selection with Up and Down, opens it with Enter, and closes with Escape or Cmd-K or Ctrl-K again.
- `search-open-result` opens a task in task details, or navigates to a project.
- `search-completed` lists matching completed tasks in their own `Completed` group after open tasks, struck through with their completion date. Task details reopen one with `Reopen`.
- `search-empty` reads `No results for “<query>”` when nothing matches.

## How to get to it (user POV)

- Web: press `/` or Cmd-K or Ctrl-K anywhere outside a text field.
- Web: choose `Search` under `Add task` in the sidebar.
- Web on a phone: tap `Open navigation`, then `Search`. The sheet docks at the bottom with the field under the results, above the keyboard.
- iOS: Planned: a search field in the main navigation.

## Driving it with control-ui and XCUITest

Preconditions:

- The baseline state. Create project `Home`, return to Inbox, then add `Fix sink #Home p2`, `Water plants tomorrow`, `Call plumber`, and `Buy milk` through quick add. Give `Call plumber` the notes `Ask about the home warranty`.
- Automated proof for every web step: `bun run test:e2e -- e2e/search.e2e.ts` and `bun run test:e2e -- e2e/mobile.e2e.ts -g search`.

- **Shortcuts.** Press `/`; the `Search` dialog opens with its field focused. Escape closes it. Cmd-K or Ctrl-K opens it and pressing it again closes it. In quick add, type `Read 1/2 of book` and press Cmd-K or Ctrl-K; the text stays and search does not open. Test: `/ and Cmd-K or Ctrl-K open search, but typing in a field never does`.
- **Match and highlight.** Type `home`. `Projects` lists `Home`. `Tasks` lists `Fix sink` with `# Home`, then `Call plumber` with the notes excerpt `Ask about the home warranty`. Each `home` is highlighted, and `Home` is selected. Press Down twice and Enter; task details open on `Call plumber`. Test: `search matches titles, notes, and projects, highlights them, and the keyboard opens a task`. The suite saves `app-web/test-results/search/desktop-light.png` and `desktop-dark.png`.
- **Every word.** Type `sink home`; only `Fix sink` is listed. Type `sink garden`; the list reads `No results for “sink garden”`. Test: `every word must match, and a miss says so`.
- **Project.** Type `hom` and press Enter. The `Home` project opens and search closes. Test: `a project result opens the project`.
- **Completed.** Add `Renew passport` and `Passport photos`, complete `Renew passport`, and search `passport`. `Tasks` lists `Passport photos` and `Completed` lists `Renew passport` with `Completed Today`. Open it, choose `Reopen`, and close; Inbox lists both again. Test: `completed tasks list after open ones and reopen from details`.
- **Phone.** Add `Fix sink p2`, `Water plants tomorrow`, and `Call plumber`. Tap `Open navigation`, then `Search`; the drawer closes and the field is focused. With the keyboard open, type `pl`. The results sit above the field and the sheet sits above the keyboard, fully on screen. `Water plants` and `Call plumber` are listed with `pl` highlighted. Tap `Water plants`; task details open on it. Test: `search opens from the drawer, docks above the keyboard, and a tap opens a task` in `e2e/mobile.e2e.ts`. The suite saves `app-web/test-results/search/mobile-light.png` and `mobile-dark.png`.
- **iOS.** Planned: search `home` in the simulator. `Fix sink` is listed.

## Gotchas

- Quick add defaults to the open project. Return to Inbox before seeding, or every seeded task lands in `Home`.
- A single letter matches only at the start of a word, so `i` does not match `milk`.
- Search shows the best 5 projects, 30 open tasks, and 15 completed tasks. Each group header shows the full count.
- On a phone, scrolling the results dismisses the keyboard.
- Headless WebKit on Linux does not draw the sheet's backdrop blur, so content behind the phone sheet looks sharper in its screenshots than on a real iPhone.
