# Comments and reactions

Comments let the people on a task talk about it, and reactions let them answer with one emoji: the owner, guests who can edit it, and AI accounts. Any task takes comments, but they matter most in shared spaces. The rules are in `shared/comments.ts`, ported to Swift as `Comments` in `app-ios/Sources/Core/Comments.swift`.

## Data

- **Comments are a synced kind.** `comments` has `taskId`, `body`, `authorId`, `createdAt`, and `editedAt`, a clock per field, and `deleted`, like tasks. They travel in the same ops, log, cursors, and nudges, so a comment works offline and arrives in real time like any other change. `KINDS` lists `comment` after `task`, so a diff names the task before its comments.
- **A comment lives in its task's space.** A comment on a shared task goes into that space. It never moves, because its task never does.
- **A comment outlives its task.** Deleting a task leaves its comments in place, so undoing the delete brings them back. Nobody sees a comment whose task is gone. The exception is a space that empties: the server's purge then deletes all its comments, a guest's included ([Sync](sync.md)).
- **Read state is a per-user marker.** `reads` holds one row per task, keyed by the task id, with `readAt`. It always lives in the reader's own space, also for a task in a space shared with them. So each user's read state syncs across their own devices and stays private. A guest never sees the owner's markers, and an AI account has none.
- **Unread means someone else wrote after the marker.** A comment is unread when its author is someone else and its `createdAt` is past the marker for its task. A comment that is still waiting for the server's author stamp counts as the reader's own.
- **Opening a task reads it.** Task details move the marker to `max(now, the newest comment by someone else)`, also when a comment arrives while the details stay open. The marker never moves back. Nothing is written when nobody else wrote since the marker, so opening a task does not add an op on every visit. Taking the newest comment's time covers a comment whose clock ran ahead.

## Server

- **The server stamps the author.** A comment's insert sets `authorId` to the sender and ignores what the client sent. After that, only the author may change a comment, and never its task or creation time: an edit or delete matches only `WHERE author_id = $actor`, so anyone else's is refused as `Only the author can edit a comment`. This applies to the owner's own sync too, so an owner cannot rewrite a guest's comment.
- **Commenting needs edit access.** `guestRefusal` lets a guest create a comment only on a task their `access` rows say they may edit, and edit or delete only their own comment on such a task. A view-only guest reads the comments but cannot write one, the same as every other write in a view share. Public links show no comments, because a link has no identity to answer as and comments can be a private conversation. Guests never write read markers into the owner's space.
- **Comments follow their task's visibility,** the way sections follow their project's. `filterSnapshot` keeps the comments whose task the guest can see, whatever project or section the task sits in, and the `shared` Sync Stream joins comments through the task's `access` row, so a new comment reaches the guest with no `access` change.
- **Activity shows comments.** A comment's first appearance on its task is one `commented` entry whose summary quotes it, such as `commented “Oat milk?”`. Undoing a comment's delete does not add another.
- **The agent API.** `GET /api/comments?id=<task>` lists a task's comments with each author. `POST /api/comments` adds one (`taskId`, `body`), and `PATCH` and `DELETE /api/comments?id=<comment>` edit or delete the caller's own. They are in `agentContract`, so `SHARED_ROUTES` and the agent docs include them, with an example per route, and AI accounts and guests reach them under the same admission as a sync.

## Clients

Web and iOS build the same behavior.

- **Rows.** A task with comments shows a speech bubble with the count. While some are unread, the bubble fills, turns the accent color, and shows the unread count instead.
- **Task details.** A `Comments` section sits under the subtasks: each comment with its author, time, `edited` when changed, and its text with links rendered like titles and notes. The user's own comments can be edited and deleted, and a delete has an undo toast. On iOS edit and delete are in the comment's context menu. Anyone who may edit the task gets the `Add a comment` field. Enter sends on the web and Shift+Enter breaks the line.
- **Authors offline.** Names come from the people cache. When a comment's author is unknown, the details call `GET /api/comments` once while online and remember the authors.

## Reactions

- **One reaction per person per task, from five emoji.** 👍 👎 👀 🛑 ❓ (`REACTIONS` in `shared/reactions.ts`, ported as `Reactions` in Swift). Picking another emoji replaces the person's reaction and picking the same one takes it back (`react`). There are no custom reactions yet; the column's validator refuses anything else.
- **A synced kind like comments.** `reactions` has `taskId`, `emoji`, `authorId`, and `createdAt`, lives in its task's space, and outlives a deleted task for undo, so the purge of an emptied space deletes it too. Its row id is `<task>:<author>`, so two devices that react offline write one row and the one-per-person rule holds by construction.
- **The server stamps the author and owns the id rule.** A put sets `authorId` to the sender, and a reaction whose id is not `<task>:<sender>` is refused, so nobody reacts as someone else. Only the author changes or deletes one (`Only the author can delete a reaction`), the owner included. A guest needs an editable task, like commenting, so a view guest sees reactions but adds none, and a public link shows none. Guests pull a task's reactions with it.
- **Rows.** Each emoji on the task is a chip at the end of the row, in the picker's order, with a count only when more than one person picked it; the user's own is outlined in the accent color. The chip names who reacted, oldest first, with `You` for the user: a tooltip on the web, the menu a tap opens on iOS. Clicking a chip picks or takes back that emoji where the user may edit the task. Unknown reactors are fetched like unknown task authors, so a name never stays `Someone` while online.
- **Picking.** `React` is a row action (`rowActions`), offered wherever the task is editable. The web shows a smiley beside Postpone on hover, whose picker opens on hover, and the row's long-press or right-click menu leads with the five emoji, which is how touch reacts. iOS puts `React` on the trailing swipe beside Postpone, opening a dialog of the five, and a `React` submenu in the context menu.
- **The agent API sets one, never toggles it.** `PUT /api/reactions` sets the caller's reaction or takes it back with `null`, and sending the one it has keeps it, so a retried call never undoes itself. Every `AgentTask` carries its `reactions` groups. The task orchestrator marks its work with them: 👀 while a worker has the task, ❓ when it needs Stefan, 🛑 when it is blocked.
- **Not yet:** reactions in activity or webhooks.

## Not built yet

- **Push for comments.** Web Push today is an alarm-driven reminder schedule for the owner's web devices, and iOS has no APNs, only local notifications from synced state. A comment push would need an immediate send path, a per-recipient fan-out to guests' own spaces, and APNs for iOS. That is not cheap, so comments notify no person yet. An agent can hear about them through a webhook (see [Integrations](integrations.md)).
- Mentions, attachments, and owners moderating other people's comments.
