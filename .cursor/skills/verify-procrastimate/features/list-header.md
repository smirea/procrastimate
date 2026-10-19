# List header and filters

Every top-level list has the same header: a filter menu at the top left and a `…` menu at the top right. Rows name who made a task when it was someone else. Rules: [List header and filters](../../../../docs/decisions/list-header.md).

## Sub-features

- `header-menu` is the `…` menu of Inbox, No date, Completed, projects, labels, places, and events. Shared entries lead in one order (`Share`, `Copy as Markdown`, `Show completed`), then a separator and the list's own (`Newest first`/`Oldest first`, `Add section`, `Rename`, the color, the project icon, `Edit place` on iOS, `Save place`, delete last). Web trigger: `<Kind> actions`, such as `Project actions` or `No date actions`. iOS: `list-actions`, in the bar, or a glass button at the top right of a tab's root list.
- `header-filters` is the funnel at the top left (`Filters`, iOS `list-filters`). Its panel lists `Created by` (when someone else made a task) and `Priority`, each choice with its count at its right. Choices with no tasks hide. The group row picks every choice; each choice toggles alone. The icon fills in the accent color while a filter is on, and `Clear filters` ends the panel. Completed has none.
- `header-filters-persist` keeps each list's filter on this device across reloads and relaunches. Another list starts unfiltered.
- `header-filters-empty` reads `No tasks match the filters` with `Clear filters` when the filter hides every row.
- `row-created-by` shows `by <name>`, with the `AI` badge for an AI account, on a row someone else made.

## How to get to it (user POV)

- Web: open any list from the sidebar; the funnel sits before the title and `…` at the right.
- iOS: on Inbox and No date the two glass buttons sit at the top; on a pushed list they are the bar's leading and trailing items.

## Driving it

- **Web.** `bun run test:e2e -- e2e/list-header.e2e.ts`: an AI account adds `Water plants p2` and `Book flights` through the agent API, the user adds `Buy milk p1` and `Call mom` in No date. Rows read `by Robo AI`; the `…` menu lists `Copy as Markdown`, `Newest first`, `Oldest first`; the filter panel lists `You 2`, `Robo AI 2`, and priorities 1, 2, and 4. Turning `Created by` on, then Robo off, then `Priority 1` on leaves `Buy milk`, which stays after a reload; Inbox has no filter; `Clear filters` restores all four. A second test checks a project's menu order. Screenshots land in `app-web/test-results/list-header/`.
- **iOS.** Launch with `PROCRASTIMATE_DEMO=sharing` and reset. Browse > `Garden` shows `by Ann Lee` and `by Claude AI`. Tap `list-filters`; the panel lists `Ann Lee 2` and `Claude AI 1`. Tap `Created by`, then `Claude`; `Buy a new hose` leaves and the icon fills red. `list-actions` on Garden lists `Copy as Markdown` and `Show completed`; on `Trip to Lisbon` it lists `Share`, `Copy as Markdown`, `Show completed`, a divider, `Add section`, `Rename`, `Icon`, `Delete project`. Drive it with `./sim test`.
- Header and filter rules: `shared/list-header.test.ts` and `shared/list-filters.test.ts`, replayed on iOS by `VectorTests`.
