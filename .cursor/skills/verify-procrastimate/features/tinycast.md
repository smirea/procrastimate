# Tinycast

The Tinycast launcher on the Mac adds and manages ProcrastiMate tasks through the `ProcrastiMate` extension in `app-tinycast/`. `Add Task` takes a line of quick add text and adds it. `Tasks` lists Today, Inbox, Tomorrow, This week, No date, a project, or a label, searches every open task as you type, and offers the typed text as a new task. Each row can be completed, moved to another date, given a priority, opened in the web app, or deleted. The extension signs in with a personal token, so tasks it adds are the user's own. An AI account token also works, and then its tasks show that AI account as their creator.

## Sub-features

- `add-command` adds the argument of `Add Task` with the quick add grammar and shows a HUD such as `Added “Call the plumber” · Tomorrow 5pm`.
- `lists` shows the picked list's tasks grouped as the apps group them, with the date in its due color, the repeat, the labels, and the project outside a project list.
- `search` filters every open task with the app's search while text is typed.
- `add-from-list` shows the typed text as a `New task` row with its parsed title, project, priority, and date, and Return adds it. A project or label list puts the task there unless the text names another project, and Today or Tomorrow date an undated task to that day.
- `complete` completes a task with Return, with an `Undo` toast unless a repeat rolled to its next date.
- `set-date` moves a task to a postpone option, a picked date and time, or no date with `⌘D`, keeping its time.
- `priority` sets priority 1 to 4 with `⌘P`.
- `open` opens the task's details in the web app with `⌘O`, and the first link in its title with `⌘L`.
- `delete` deletes a task and its subtasks with `⌃X` after a confirmation.
- `bad-token` shows `ProcrastiMate refused the token` with `Open Preferences` when the token is wrong or revoked, and an empty `Tasks` list says the same instead of `All clear`.

## How to get to it (user POV)

- Mac, Tinycast: type `Add Task`, press Tab, type the task, and press Return.
- Mac, Tinycast: type `Tasks` and press Return. Pick a list from the dropdown at the right of the search bar, and open a row's actions with `⌘K`.

## Driving it with Tinycast

Preconditions:

- `bun run --cwd app-tinycast build`, then Tinycast → Settings → Extensions → Add from folder → `app-tinycast/dist`.
- A personal token from ProcrastiMate's Settings (`Personal token`, `Generate token`), pasted as the extension's `API Token`. For a disposable account, run the server locally, sign up, generate a personal token, and set `Server` to the local address.

- **Add command.** Run `Add Task` with `Call the plumber tomorrow 5pm p1`. The HUD reads `Added “Call the plumber” · Tomorrow 5pm`, and the web app's Tomorrow list shows it at 5pm with a red flag.
- **Lists.** Run `Tasks`, pick `Tomorrow`. The row shows `Call the plumber` with `Tomorrow 5pm`.
- **Add from a list.** In `Today`, type `Water plants`. A `New task` row reads `Water plants` with `No date`; Return adds it, the toast reads `Added “Water plants” · Today`, and it appears under `Today`.
- **Move a date.** On `Call the plumber`, `⌘D` → the first option. The row leaves Tomorrow, and the web app shows the new day at 5pm.
- **Complete and undo.** Return on `Water plants`. The toast reads `Completed “Water plants”` and the row goes; `Undo` brings it back.
- **Bad token.** Set the token to `pm.nobody.secret` and run `Add Task`. The toast reads `ProcrastiMate refused the token`.

## Gotchas

- Tinycast keeps a copy of the extension. Rebuild and add the folder again after a change.
- The list opens from the last cached view and refreshes behind it, so a change made elsewhere shows a moment later.
- The create route takes no date, so a task added from Today or Tomorrow without one gets a second request to date it.
