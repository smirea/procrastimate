# Projects

Projects let Stefan group tasks, open a project to see its tasks, and move a task from one project to another.

## Sub-features

- `projects-create` creates a project.
- `projects-open` lists a project's tasks.
- `projects-move` moves a task to another project or back to Inbox.
- `projects-rename` renames a project.
- `projects-delete` deletes a project and its tasks.

## How to get to it (user POV)

- Web: use the projects section of the sidebar.
- Web: pick a project in quick add or in task details.
- iOS: use the projects section of the main navigation.

## Driving it with control-ui and simctl

Preconditions:

- The baseline state, with Inbox seeded with `Buy milk` and no projects.

- **Create.** Planned: create the project `Home` on the web. `Home` appears in the sidebar and opens empty.
- **Move.** Planned: move `Buy milk` to `Home` from its details. It leaves Inbox and appears in `Home`.
- **Rename.** Planned: rename `Home` to `House`. The sidebar and task details show `House`.
- **Delete.** Planned: delete `House` and confirm. The project and `Buy milk` are gone from every view.
- **iOS.** Planned: open `House` in the simulator before the delete step. It lists `Buy milk`.

## Gotchas

- Deleting a project deletes its tasks. Seed a fresh project for this step, never a shared one.
- Moving a task keeps its due date, so it stays in Today or Upcoming. Check those views too.
