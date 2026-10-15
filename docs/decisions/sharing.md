# Sharing

Sharing lets the owner of a space give other people, AI accounts, or anyone with a link access to some or all of it. The shapes are in `shared/sharing.ts`, the tables in `shared/db/schema.ts`, and the routes in `shared/api/contract.ts`.

## Concepts

- **Space.** One user's tasks, projects, and labels, served by the `Account` object named by that user's id. Every entity stays in the space it was created in. A new task takes its parent's space, else its project's, else its label's when it is added from a label view, else the creator's own. Projects and labels a guest creates are always the guest's own. Nothing moves between spaces.
- **Actor.** Who makes a request: `{ id, name, kind, ownerId }` in the `x-procrastimate-actor` header, which only the Worker sets. A space's object serves the actor when the actor owns the space, holds a live share in it, or reads it through a public link. Anything else gets `FORBIDDEN`.
- **Share.** A row in the owner's space. It targets the whole space, a project, a label, or a task, and grants `view` or `edit`. A share with no grantee is a public link, always `view`, whose id is the secret in the token `<ownerId>.<id>`. Revoking deletes the row. Only AI accounts are offered whole-space shares.
- **Membership.** A row in the guest's space naming a space shared with them. The owner's object writes it. It is a cache: the owner's shares are the truth, and a `403` on a shared space's sync drops the membership.
- **People.** A per-space cache of everyone the space has met, so activity and share lists can name them offline.
- **AI account.** A Better Auth user with `kind: 'ai'` and an `ownerId`. It has no credential, so it never signs in. It acts through API tokens `pm.<ownerId>.<secret>`, whose SHA-256 the owner's space stores. Creating one also shares the owner's whole space with it, to edit.

## Data

- **The log names who wrote each row.** `log.actor` is the user id that sent the op, or `server` for a fixup, and `log.at` is the server's time. The server stamps both and keeps them off the wire. Rows from before sharing read as `server` at `0`.
- **Tasks know who made and finished them.** `createdBy` and `completedBy` are stamped by the server, which overwrites whatever a client sends. `lastCompletedAt` is written by `completeTask` on every completion, a recurring roll included, so a roll reads differently from a postpone. Undo restores it.
- **Shared spaces live apart in the stored document.** `spaces` maps each owner id to a section with its own cursor, outbox, epoch, scope hash, read-only task ids, and data. The document's one sync clock serves every space. A section that fails validation is dropped on its own and refills on its next sync, so a bad shared space never wipes the user's own tasks. Switching users drops every section.

## Sync

- **Same protocol, one space per request.** `POST /api/sync?space=<ownerId>` syncs a shared space; no `space` is the caller's own. The Worker routes on the query alone and never reads bodies. A guest sends `scope`, the hash of what it last saw, and gets either no changes or a fresh filtered snapshot with `readOnly`.
- **A nudge names its space.** A socket nudge with `space` tells the client to sync that section.
