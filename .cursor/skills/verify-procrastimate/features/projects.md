# Projects

Projects let Stefan group tasks, open a project to see its tasks, and move a task from one project to another.

## Sub-features

- `projects-create` creates a project.
- `projects-open` lists a project's tasks.
- `projects-assign` assigns a project in quick add by typing `#Name`.
- `projects-autocomplete` suggests projects after `#` in quick add and the task title, and offers to create a missing one.
- `projects-move` moves a task to another project or back to Inbox.
- `projects-reorder` drags a project to a new place in the list, and the order syncs.
- `projects-rename` renames a project.
- `projects-icon` gives a project an icon from the shared set, or none for `#`.
- `projects-delete` deletes a project, its sections, and its tasks after confirmation.
- `sections-create` adds a section to a project.
- `sections-group` lists a project's tasks in no section first, then each section with its tasks.
- `sections-add-task` adds a task straight into a section.
- `sections-quick-add` puts a task in a section by typing `/Name`, with suggestions after `/`.
- `sections-move` moves a task into a section from task details.
- `sections-rename`, `sections-reorder`, and `sections-delete` rename, move up or down, and delete a section with its tasks.

## How to get to it (user POV)

- Web: use the projects section of the sidebar. `Add project` creates one.
- Web on a phone: tap `Open navigation` to reach the projects section.
- Web: pick a project in quick add or in task details, or type `#Name` in quick add or the task details title.
- Web: type `#` in quick add or the task details title to open project suggestions above the field.
- Web: use `Project actions` in a project's header to rename or delete it, or to pick its icon from the `Project icon` grid.
- Web: drag a project in the sidebar with the mouse, or long-press then drag on touch. With a project link focused, Alt+Up and Alt+Down move it.
- iOS: long-press a project in Browse and drag it.
- iOS: open the Browse tab. `Add project` in the Projects header creates one.
- iOS: use `Project actions` in a project's toolbar to rename or delete it, or its `Icon` submenu to pick an icon.
- Web: `Add section` at the end of a project. Each section heading has an accent `+` (`Add task to <name>`) that opens quick add in it, and its title is the `<name> actions` button, whose menu is titled with the section's name (Rename, Move up, Move down, Delete section). No `…`, and no `Add task` row at a section's end.
- iOS: `Add section` in `Project actions`. Each section heading has an accent `+` (`add-task-<name>`, labeled `Add task to <name>`). Tap or long-press the rest of the header for a menu titled with the section's name: Add task, Copy as Markdown, Rename, Move up, Move down, and Delete section. In an XCUITest, launch with `PROCRASTIMATE_DEMO=sections` and tap `app.buttons["heading-Later"]`.

## Driving it with control-ui and the simulator

Preconditions:

- The baseline state, with no projects.
- Automated proof for the create, assign, move, rename, delete, and reorder steps: `bun run test:e2e -- e2e/projects.e2e.ts`.

- **Create.** Choose `Add project`, type `Home`, and press Enter. `Home` appears in the sidebar and opens with `No tasks yet`. Test: `create, pick an icon, assign with #, move, rename, delete, and undo deleting a project`, which also runs Icon, Assign, Move, Rename, and Delete below.
- **Assign.** In quick add, save `Fix sink #home` and `Paint fence`. The `Home tasks` list has both tasks, titled without `#home`.
- **Autocomplete.** With projects `Home`, `Homework`, and `Errands`, type `Fix sink #ho` in quick add. The `Projects` list opens above the field with `Home`, `Homework`, and `Create project “ho”`, and `Home` is selected. Press Down, then Enter; the field reads `Fix sink #Homework ` and the project chip reads `Homework`. Type `#e` and press Escape; the list closes and quick add stays open. Type `#rr` in a fresh fragment and press Tab to insert `#Errands `.
- **Create from autocomplete.** Type `Plant tomatoes #Garden`. The only row is `Create project “Garden”`. Press Enter; `#Garden` is highlighted. Save, and `Garden` in the sidebar lists `Plant tomatoes`.
- **Exact name.** Type `Fix sink #home` and press Enter. The task saves even though the list is open.
- **Title autocomplete.** Open `Buy milk`, type ` #err` at the end of the title, and click `Errands`. The title reads `Buy milk #Errands ` with focus kept. Press Enter; the project chip reads `Errands`.
- **Move.** Add `Buy milk` in Inbox, open it, and pick `Home` from the project chip. It leaves Inbox and `Home` has three tasks.
- **Create from the picker.** In quick add, open the project chip and choose `New project`. A `Project name` field appears in the dropdown with focus. Type `Garden` and press Enter; the dropdown closes, `Garden` is in the sidebar, and the chip reads `Garden`. Escape cancels. On iOS, `New project…` at the end of the project menu (quick add's chip and the task details toolbar) opens a `New project` alert, and `Create` picks the new project.
- **Reorder.** Create `Home`, `Work`, and `Errands`. Drag `Errands` onto `Home`; the sidebar reads `Errands`, `Home`, `Work`, and the project that was open stays open. A plain click on `Work` still opens it. Focus `Home` and press Alt+Down; it moves below `Work` and keeps focus. Drag a project right after Alt+Down, while the rows still slide; it lands where it is dropped. The order survives a reload and shows in quick add's project picker. On a phone, open the drawer, hold `Errands` until it lifts, and drag it up; the drawer stays open. Tests: `bun run test:e2e -- e2e/projects.e2e.ts`, which saves `app-web/test-results/projects/desktop-lifted.png` and `phone-lifted.png`. On iOS, long-press `Errands` in Browse, drag it above `Home`, and release; the quick add project menu lists the same order. Core rules run in `swift test` (`VectorTests` store).
- **Rename.** Choose `Project actions`, then `Rename`, and enter `House`. The heading and sidebar show `House`.
- **Delete.** Choose `Project actions`, then `Delete project`. The prompt reads `Delete House and its 3 tasks?`. Confirm. The app returns to Inbox, `House` is gone from the sidebar, and `Buy milk` is in no view. The toast reads `Deleted “House”`; its `Undo` brings `House` back with its sections and all 3 tasks. Deleting a section shows the same toast and undo.
- **Icon.** In `Home`, open `Project actions`; the `Project icon` grid has 38 choices with `No icon` checked. Pick `Home`; the sidebar link, the header before `Home`, and the task details project chip draw a house. Pick `No icon`; every place draws `#` again. Test: `create, pick an icon, assign with #, move, rename, delete, and undo deleting a project`, which saves `app-web/test-results/projects/icon-picker.png`. On iOS (`PROCRASTIMATE_DEMO=sections`), `Project actions`, `Icon`, `Home` puts a house before the bar title `Home` and on its Browse row; `No icon` takes it off.
- **Phone.** Tap `Open navigation`, `Add project`, type `Home`, and press return. `Home` opens and the drawer closes. Add `Fix sink #home p3` and `Paint fence fri`. Open Inbox, then `Home` from the drawer; `Home tasks` lists `Paint fence` then `Fix sink`.
- **Phone drawer, automated.** At 393 px, `Open navigation` and `Add project` `Home`, `Work`, and `Errands`; the drawer closes after each. Long-press `Errands`, drag it to the top, then tap `Work`; the drawer closes and quick add `Fix sink` lands in `Work`. Test: `a long press lifts a project and dragging moves it, leaving the drawer open, and a tap opens it` in `e2e/projects.e2e.ts`.
- **Phone autocomplete.** Create `Home` and `Errands` from the drawer, tap `Quick add`, and type `Fix sink #h` with the keyboard open. The `Projects` list sits above the field, fully on screen, with `Home` and `Create project “h”`. Tap `Home`; the field reads `Fix sink #Home ` and keeps focus. Type `#Garden` and tap `Create project “Garden”`; the project chip reads `Garden`.
- **iOS.** In Browse, tap `Add project`, type `Home`, and press return; `Home` opens with `No tasks yet`. Quick add from the tab bar `+` there starts with `Project Home`, so `Fix sink p3` and `Paint fence fri` land in `Home`, listed `Paint fence` then `Fix sink`, and Browse shows `Home` with `2`. `Project actions`, `Rename` opens an alert prefilled with the name; entering `House` retitles the screen and the Browse row. `Delete project` confirms with `Delete House and its 3 tasks?`, then goes back to Browse without `House`, and its tasks are gone from search. An unknown `#Personal` shows `Create #Personal` in quick add's chip row and creates the project only when tapped. In task details, the toolbar's `Project Inbox` menu moves `Buy milk` to `Home`, and it leaves Inbox.
- **Sections.** In `Home`, choose `Add section`, type `Later`, press Enter, then add `Next up` the same way. Both headings show, `Later` first. Choose `Add task to Later` on its heading and save `Fix fence`; quick add's project chip reads `Home / Later`, and the task lands under `Later`. In quick add type `Paint door #Home /next`; the `Sections` list offers `Next up`, Tab inserts `/Next up `, and the task lands under `Next up`. Open `Water plants` in no section, open the project chip, and pick `Next up` under `Home`; the chip reads `Home / Next up`. `Copy Home as Markdown` gives `# Home`, `## Later`, `## Next up` with their tasks. Click the `Next up` title (`Next up actions`); the menu is titled `Next up`, and `Move up` puts `Next up` first. `Later actions`, `Rename` to `Someday` survives a reload. `Someday actions`, `Delete section` asks `Delete Someday and its 1 task?` and removes `Fix fence`. Tests: `bun run test:e2e -- e2e/sections.e2e.ts`, which saves `app-web/test-results/sections/project.png`, `quick-add.png`, and `menu.png`.
- **Sections on iOS.** A debug build launched with `PROCRASTIMATE_DEMO=sections` seeds `Home` with `Next up` (5 tasks) and `Later` and opens it; add `quickadd type:Paint+shed+/ne` to see the `Sections` suggestions, or `type:Paint+shed+/later+` to see the chip read `Home / Later`. Core rules run in `swift test` (`VectorTests` store, views, markdown, quick-add, todoist; `QuickAddDraftTests`).

## Gotchas

- Deleting a project deletes its tasks. Deleting a section deletes its tasks too.
- On iOS a Browse project row has no context menu, so a long press always lifts it to reorder. Copy a project as Markdown from its `Project actions` menu.
- A touch that lands while the drawer is still flinging from a swipe cannot lift a project, since the browser owns that gesture. Let the scroll stop first.
- `/Name` only reads the sections of the project in effect: the typed `#Project`, else the one quick add opened with. Without a project it stays text. Seed a fresh project for this step, never a shared one.
- `#Name` is highlighted only for an existing project. An unknown `#word` stays in the title.
- Escape closes the suggestions for that `#` until the `#` is deleted, so typing more does not reopen them.
- Picking a suggestion appends a space, which closes the list. Enter picks while the list is open unless the typed name already matches a project and the selection was not moved.
- Moving a task keeps its due date, so it stays under its day in Inbox. Check Inbox too.
