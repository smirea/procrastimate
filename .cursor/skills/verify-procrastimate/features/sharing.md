# Sharing

The owner shares a project, a label, or a task with another account, to edit or to view, or as a public link anyone can open read only. Shared things show under `Shared with me` for the other account, with the owner's name. Every task records who created it and who completed it, and its details list what happened to it and who did it. AI accounts belong to a human, have no sign-in, and act through API tokens the human generates in Settings. See `docs/decisions/sharing.md`.

## Sub-features

- `share-person` adds a person by email, or from people already met, with `Can edit` or `Can view`, and removes them.
- `share-link` copies a public link `https://procrastimate.stf.lol/s/<ownerId>.<secret>` and stops sharing it.
- `shared-with-me` lists each shared project, label, and task under `Shared with me` with the owner's name. Shared tasks never show in Inbox, Today, No date, places, or search.
- `guest-edit` lets a guest with `Can edit` add, edit, complete, and delete tasks in what was shared. A `Can view` guest gets no checkbox, editable title, delete, or add.
- `pickers-stay-in-space` lists only the shared space's projects and labels on a shared task.
- `authorship` shows `Created by` and `Completed by` in task details, offline too.
- `activity` lists each change to a task with who and when, when online. It shows only when someone other than you touched the task.
- `public-link` opens `/s/<token>` read only for a signed-out visitor. A stopped link shows nothing. On an iPhone with the app installed, the link opens the app.
- `ai-accounts` creates an AI account by name, generates a token shown once with `Copy`, and deletes the account. People that are AI accounts carry an `AI` badge everywhere.
- `agent-docs` serves public Markdown at `/api/docs` (and `/llms.txt` pointing to it) on how an agent gets a token, and, with a token, `/api/docs/agent` and `/api/docs/openapi` covering exactly the routes it may call. `Copy prompt for your AI` beside a new token copies the token and where the guide is.
- `agent-api` lets an AI token read `GET /api/view` and add, edit, complete, reopen, and delete tasks through `/api/tasks`, credited to the AI.

## How to get to it (user POV)

- Web: open a project or label page and click the share icon at the top right, or the share icon in task details. Settings holds `AI accounts`.
- iOS: the share action on a project or label screen and in task details. Browse holds `Shared with me`. Settings holds `AI accounts`.
- Anyone: open a `/s/…` link in a browser.

## Driving it

- **Two accounts on the web.** `bun run test:e2e -- e2e/sharing.e2e.ts` in the repo root. It signs up an owner and a guest in two browser contexts. The owner shares a project by the guest's email; the guest finds it under `Shared with me`, completes a task; the owner sees `Completed by` with the guest's name and an activity line naming them. The second test opens a link in a signed-out context, sees the tasks read only, then sees nothing after `Stop sharing`.
- **By hand.** Two browser profiles at `http://procrastimate.localhost:6120`, each signed up with its own email. In profile A, add a project with a task, open the share sheet, type B's email, and `Add`. In profile B, the project shows under `Shared with me` within a second. Complete the task in B; in A the task is completed, and its details read `Completed by <B>` with the activity line `<B> completed it`.
- **Agent API.** In Settings, create an AI account and `Generate token`. Then `curl -H "Authorization: Bearer <token>" -H 'content-type: application/json' -d '{"text":"Water the plants tomorrow"}' http://127.0.0.1:6120/api/tasks`. The task shows in the owner's Inbox for tomorrow, and its details read `Created by <AI name> AI`.
- **Agent docs.** `curl http://127.0.0.1:6120/api/docs` answers Markdown with no token. With the token from `Generate token`, `curl -H "Authorization: Bearer <token>" http://127.0.0.1:6120/api/docs/agent` lists eight routes with curl examples; without it, `401`. In Settings, `Copy prompt for your AI` puts a paragraph with the token and the guide URL on the clipboard. `bun test server/src/docs.test.ts` runs every example against a real space.
- **Universal Links.** `curl -i https://procrastimate.stf.lol/.well-known/apple-app-site-association` answers `200` with `Content-Type: application/json` naming `FNYFHG5SV7.com.stefan.procrastimate` and `/s/*`. Locally, `bun run preview` serves the same file at `http://127.0.0.1:8787`.

## Gotchas

- A share needs its target on the server, so the share sheet uploads unsent edits first.
- The e2e clock is pinned to October 14 while the server uses real time, so activity times read `tomorrow` in the tests.
- An AI token works only on sync, view, the task commands, and activity. Shares, tokens, AI accounts, and push answer `FORBIDDEN`.
- Revoking a share drops the guest's unsent edits to that space.
