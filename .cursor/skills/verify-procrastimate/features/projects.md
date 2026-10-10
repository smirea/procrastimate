# Projects

Projects let Stefan group tasks, open a project to see its tasks, and move a task from one project to another.

## Sub-features

- `projects-create` creates a project.
- `projects-open` lists a project's tasks.
- `projects-assign` assigns a project in quick add by typing `#Name`.
- `projects-move` moves a task to another project or back to Inbox.
- `projects-rename` renames a project.
- `projects-delete` deletes a project and its tasks after confirmation.

## How to get to it (user POV)

- Web: use the projects section of the sidebar. `Add project` creates one.
- Web: pick a project in quick add or in task details, or type `#Name` in quick add.
- Web: use `Project actions` in a project's header to rename or delete it.
- iOS: use the projects section of the main navigation.

## Driving it with control-ui and XCUITest

Preconditions:

- The baseline state, with no projects.
- Automated proof for every web step: `bun run test:e2e -- e2e/projects.e2e.ts`.

- **Create.** Choose `Add project`, type `Home`, and press Enter. `Home` appears in the sidebar and opens with `No tasks yet`. Test: `create, assign with #, move, rename, and delete a project`.
- **Assign.** In quick add, save `Fix sink #home` and `Paint fence`. The `Home tasks` list has both tasks, titled without `#home`.
- **Move.** Add `Buy milk` in Inbox, open it, and pick `Home` from the project chip. It leaves Inbox and `Home` has three tasks.
- **Rename.** Choose `Project actions`, then `Rename`, and enter `House`. The heading and sidebar show `House`.
- **Delete.** Choose `Project actions`, then `Delete project`. The prompt reads `Delete House and its 3 tasks?`. Confirm. The app returns to Inbox, `House` is gone from the sidebar, and `Buy milk` is in no view.
- **iOS.** Planned: open `House` in the simulator. It lists `Buy milk`.
- **Proof.** The suite saves `app-web/test-results/view-project.png`.

## Gotchas

- Deleting a project deletes its tasks. Seed a fresh project for this step, never a shared one.
- `#Name` is highlighted only for an existing project. An unknown `#word` stays in the title.
- Moving a task keeps its due date, so it stays in Today or Upcoming. Check those views too.
