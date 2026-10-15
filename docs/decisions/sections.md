# Sections

Todoist-style sections: named headings inside one project that group its tasks.

## Model

- **A synced entity of its own.** A section is `{ id, projectId, name, order, createdAt, sourceKey? }`, its own sync kind (`section`) and its own `sections` table, with a clock per field like every other kind. Sections are not a JSON list on the project, because arrays are single last-writer-wins fields here: two devices adding or renaming sections offline would drop one device's change, and a stale list could bring back a deleted section.
- **Order is fractional.** Sections sort by `order`, then `createdAt`, then `id`, like subtasks. Moving one writes only its own `order` (`moveSection`, built on `moveOrders` in `shared/sync/order.ts`). A new section goes last in its project.
- **A task's `sectionId`.** A top-level task can sit in one section of its own project. Subtasks never have a section: they show under their parent, so moving a parent never rewrites its subtree. Tasks inside a section keep the project view's usual sort (due, then priority, then creation); there is no manual task order.
- **Names are unique within a project, ignoring case**, because `/name` in quick add must resolve to one section. `addSection` with a taken name returns the existing section, and `renameSection` refuses a taken name. The same name may repeat across projects.
- **Swift calls it `ProjectSection`.** SwiftUI already has `Section`, so the schema's id is `ProjectSection` and Core aliases `ProjectSection = API.ProjectSection`. TypeScript keeps `Section`, as it keeps `Task` where Swift has `TaskItem`.

## Store rules

`shared/store.ts`, ported to `StoreRules.swift` with vectors:

- `updateTask` with a `sectionId` moves a top-level task into that section's project. A new `projectId` without a `sectionId` leaves the task in no section, `projectId: null` moves it to Inbox, and `sectionId: null` keeps the project. A subtask never takes a section. `addTask` follows the same rule for `NewTask.sectionId`, so the agent API can create a task from a section id alone.
- **Deleting a section deletes its tasks**, subtasks included, as Todoist does and as deleting a project does. Both clients confirm with `Delete <name> and its N tasks?`, counting done tasks and subtasks (`sectionTasks`), or `Delete <name>?` when it holds none. Moving tasks to `No section` first is how to keep them.
- Deleting a project deletes its sections too.

## Concurrent edits

`fixups` repairs, in this order: project merges carry their sections to the surviving project, and a section whose project is gone is deleted. Sections then merge by `sourceKey` (one Todoist import on two devices), then by name within a project, into the oldest. Last, a task keeps its `sectionId` only while it is top level and the section is a live one of its project; otherwise it stays in its project in no section. So a task moved into a section that another device deleted survives, and a task moved to another project leaves its old section. The convergence fuzz adds, renames, moves, and deletes sections and checks these invariants.

## Views

- `projectGroups` in `shared/views.ts` (ported to `Views.projectGroups`) is the project view: the tasks in no section first, under no heading, then every section in order, empty ones included, so each stays a place to add to.
- Web: each section has a heading with its task count, a copy button, and an actions menu (Rename, Move up, Move down, Delete section), its own `Add task` that opens quick add in that section, and the project ends with `Add section`. Rows elsewhere name their place as `Project / Section`.
- iOS: section headers in the project screen open a menu on long press (Add task, Copy as Markdown, Rename, Move up, Move down, Delete section). `Add section` is in the project's actions menu. Reordering is Move up and Move down on both clients rather than drag, so the two match and work without precise touch.
- **Copy as Markdown** of a project is `projectDocument`: the loose tasks first, then `## <section>` with its tasks. Empty sections are left out. A section heading copies just that section.

## Picking a section

- The project picker in quick add and task details lists sections under their project. The web indents them. iOS menus cannot indent, so a project with sections opens a submenu with `No section` and each section. The chip reads `Project / Section`.
- **Quick add `/name`**, as in Todoist. It resolves among the sections of the project typed with `#`, else the project quick add opened with (the open project, or the picked one). With neither, `/` stays text. It must start the text or follow a space, so `and/or` and paths never parse. `/` opens suggestions of the project's sections with `Create section "<name>"`, in the user's own projects only. An unknown `/word` offers no create chip, since a slash is common in titles. A typed project other than the one quick add opened with drops the default section. The task details title parses `/name` against the task's project; a subtask's never does. The App Intents' add task reads `/name` in its text the same way.

## Sharing

Sections follow their project's visibility: a guest sees every section of each project in its view, and none of a project it cannot see. Sections are never a guest's to write, and a guest's task op may only name a section in its view (`staysInScope` in `shared/scope.ts`). Public links of a project show its sections. The agent command API returns `sections` in its view and takes `sectionId` and `/name` in `text` when creating a task.

## Todoist import

Each `section` row starts a section in that project, and the top-level tasks after it, until the next section row, belong to it. Subtasks sit in no section. A section's source key is `todoist:section:<project id>:<name>`, numbered like task keys when a name repeats. On import, a section matches by source key, then by name in its project. A repeated name in one project lands in the one section that has it, since names are unique per project. A section row also ends the indent nesting above it, in Inbox too. Re-importing a backup puts already-imported top-level tasks that are still in no section, and still in that project, into their section, so a backup imported before sections existed gains them. Task source keys never included the section, so they are unchanged for Todoist's exports, which always start a section with an unindented task. Todoist's Inbox can hold sections but ours is not a project, so those rows are left out with a warning.
