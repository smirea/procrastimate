# Projects

Projects let Stefan group tasks, open a project to see its tasks, and move a task from one project to another.

## Sub-features

- `projects-create` creates a project.
- `projects-open` lists a project's tasks.
- `projects-assign` assigns a project in quick add by typing `#Name`.
- `projects-autocomplete` suggests projects after `#` in quick add and the task title, and offers to create a missing one.
- `projects-move` moves a task to another project or back to Inbox.
- `projects-rename` renames a project.
- `projects-delete` deletes a project and its tasks after confirmation.

## How to get to it (user POV)

- Web: use the projects section of the sidebar. `Add project` creates one.
- Web on a phone: tap `Open navigation` to reach the projects section.
- Web: pick a project in quick add or in task details, or type `#Name` in quick add or the task details title.
- Web: type `#` in quick add or the task details title to open project suggestions above the field.
- Web: use `Project actions` in a project's header to rename or delete it.
- iOS: use the projects section of the main navigation.

## Driving it with control-ui and XCUITest

Preconditions:

- The baseline state, with no projects.
- Automated proof for every web step: `bun run test:e2e -- e2e/projects.e2e.ts`.

- **Create.** Choose `Add project`, type `Home`, and press Enter. `Home` appears in the sidebar and opens with `No tasks yet`. Test: `create, assign with #, move, rename, and delete a project`.
- **Assign.** In quick add, save `Fix sink #home` and `Paint fence`. The `Home tasks` list has both tasks, titled without `#home`.
- **Autocomplete.** With projects `Home`, `Homework`, and `Errands`, type `Fix sink #ho` in quick add. The `Projects` list opens above the field with `Home`, `Homework`, and `Create project “ho”`, and `Home` is selected. Press Down, then Enter; the field reads `Fix sink #Homework ` and the project chip reads `Homework`. Type `#e` and press Escape; the list closes and quick add stays open. Type `#rr` in a fresh fragment and press Tab to insert `#Errands `. Test: `# suggests projects as you type and the keyboard picks one` in `e2e/project-autocomplete.e2e.ts`. The suite saves `app-web/test-results/project-autocomplete.png`.
- **Create from autocomplete.** Type `Plant tomatoes #Garden`. The only row is `Create project “Garden”`. Press Enter; `#Garden` is highlighted. Save, and `Garden` in the sidebar lists `Plant tomatoes`. Test: `# offers to create a project that does not exist`.
- **Exact name.** Type `Fix sink #home` and press Enter. The task saves even though the list is open. Test: `a fully typed project name still saves on Enter`.
- **Title autocomplete.** Open `Buy milk`, type ` #err` at the end of the title, and click `Errands`. The title reads `Buy milk #Errands ` with focus kept. Press Enter; the project chip reads `Errands`. Test: `# autocompletes in the task details title and a click picks`.
- **Move.** Add `Buy milk` in Inbox, open it, and pick `Home` from the project chip. It leaves Inbox and `Home` has three tasks.
- **Rename.** Choose `Project actions`, then `Rename`, and enter `House`. The heading and sidebar show `House`.
- **Delete.** Choose `Project actions`, then `Delete project`. The prompt reads `Delete House and its 3 tasks?`. Confirm. The app returns to Inbox, `House` is gone from the sidebar, and `Buy milk` is in no view.
- **Phone.** Tap `Open navigation`, `Add project`, type `Home`, and press return. `Home` opens and the drawer closes. Add `Fix sink #home p3` and `Paint fence fri`. Open Inbox, then `Home` from the drawer; `Home tasks` lists `Paint fence` then `Fix sink`. Test: `the navigation drawer creates a project and switches to it` in `bun run test:e2e -- e2e/mobile.e2e.ts`. The suite saves `app-web/test-results/mobile/project.png`.
- **Phone autocomplete.** Create `Home` and `Errands` from the drawer, tap `Quick add`, and type `Fix sink #h` with the keyboard open. The `Projects` list sits above the field, fully on screen, with `Home` and `Create project “h”`. Tap `Home`; the field reads `Fix sink #Home ` and keeps focus. Type `#Garden` and tap `Create project “Garden”`; the project chip reads `Garden`. Test: `# suggests projects above the keyboard and a tap picks or creates one` in `bun run test:e2e -- e2e/mobile.e2e.ts`. The suite saves `app-web/test-results/mobile/project-autocomplete.png` and `project-autocomplete-create.png`.
- **iOS.** Planned: open `House` in the simulator. It lists `Buy milk`.
- **Proof.** The suite saves `app-web/test-results/view-project.png`.

## Gotchas

- Deleting a project deletes its tasks. Seed a fresh project for this step, never a shared one.
- `#Name` is highlighted only for an existing project. An unknown `#word` stays in the title.
- Escape closes the suggestions for that `#` until the `#` is deleted, so typing more does not reopen them.
- Picking a suggestion appends a space, which closes the list. Enter picks while the list is open unless the typed name already matches a project and the selection was not moved.
- Moving a task keeps its due date, so it stays in Today or Upcoming. Check those views too.
