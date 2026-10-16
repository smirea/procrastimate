# Comments

Comments let the people on a task talk about it, such as Gus asking `Oat milk?` on Olive's shared `Buy milk`. Any task takes comments. Rows show how many a task has, and the bubble turns the accent color with the unread count while someone else's comments are unread. Opening the task reads them. See `docs/decisions/comments.md`.

## Sub-features

- `comments-add` adds a comment from `Add a comment` in task details. Enter or the send button posts it. Blank text posts nothing.
- `comments-links` renders links in a comment like titles and notes, tappable in the accent color.
- `comments-edit` edits the user's own comment. The comment then shows `edited`.
- `comments-delete` deletes the user's own comment, with an undo toast.
- `comments-badge` shows a bubble and the count on a commented task's row.
- `comments-unread` fills the bubble in the accent color with the unread count while comments by someone else are unread.
- `comments-read` reads a task's comments when its details open, also for comments that arrive while they stay open. The read state syncs to the user's other devices.
- `comments-shared` syncs comments between the owner and guests in real time. An edit guest comments, a view guest only reads, and a public link shows no comments.
- `comments-activity` lists `<name> commented` in the task's activity.
- `comments-agent` lets an AI account list, add, edit, and delete its own comments through `/api/comments`.

## How to get to it (user POV)

- Web: open a task, scroll to `Comments` under the subtasks, type in `Add a comment`, and press Enter. Hover your comment for the pencil and trash buttons.
- iOS: open a task, type in `Add a comment` under the subtasks, and tap the send button. Long-press your comment for Edit and Delete.
- Both: the row's bubble sits in the row's detail line, next to the reminders count.

## Driving it

Preconditions: two accounts in two browser contexts, the owner with a project shared to the guest's email with `edit`.

1. As the guest, open the shared project from `Shared with me`, open a task, and post `Oat milk? https://example.com/oat`. Expect the comment under `You · just now` with the link underlined, and after closing, the row shows a gray bubble with `1`.
2. As the owner, without reloading, expect the same row to show an accent bubble with `1` (accessible name `1 unread of 1 comments`) within a few seconds.
3. Open the task. Expect the comment by `Gus` and `Gus commented` in Activity. Close it and expect the gray bubble with `1`.
4. Post a reply as the owner, edit it, and delete it. Expect `edited` after the edit and an undo toast after the delete.
5. Change the share to `view` and reload the guest. Expect the comments with no `Add a comment` field.

`app-web/e2e/sharing.e2e.ts` covers steps 1 to 3 on the web. iOS: `PROCRASTIMATE_SIGNED_IN=1 PROCRASTIMATE_DEMO=sharing` seeds Ann's Garden with unread comments on `Plant the tulip bulbs` and `Buy a new hose`.
