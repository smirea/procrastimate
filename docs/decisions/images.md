# Task images

Tasks can hold images. Web attaches them from a file picker, a paste, or a drop onto task details. iOS attaches them from the photo library, the camera, or the pasteboard. Details show thumbnails, the row shows a count, a tap opens the image full screen, and an image can be deleted with undo.

## Data

- **A task lists its images.** `tasks.images` is a list of `{ id, width, height }` (`ImageRef` in `shared/values.ts`), one last-writer-wins field like `labelIds`. Two devices that add images to the same task offline keep one device's list, which [Sync](sync.md) already accepts for arrays. The id is a client-made UUID, so creating offline never collides. `width` and `height` let a client lay the image out before its bytes arrive.
- **Visibility is the task's.** Because the list is a task field, `filterSnapshot` hands a guest only the images of tasks it may see, and `admit` lets a guest change the list only on a task it may edit. There is no image kind to sync or scope. A task in a section follows its project's share, and its subtasks follow it, the same scope comments use.
- **Bytes never sync.** The bytes live in the server's `images` table, one row per size (`full` and `thumb`), keyed by user, id, and size. Neither the snapshot, the log, nor the stored document holds them.

## Storage in Turso

- **Turso holds them, in rows small enough for every store.** Clients scale the full image to 2048 px on its long side and the thumbnail to 320 px, then step the quality down until they fit 1.5 MB and 200 KB (`IMAGE_LIMITS` in `shared/images.ts`). The cap comes from the stores: the Durable Object's SQLite caps a row at 2 MB, and a local `sqld`, Turso's server, took a 4 MB blob in one statement and refused 8 MB. So one row holds one image, with no chunking. The Worker forwards the body to the object unread, so its 10 ms CPU limit never sees the bytes, and requests up to 100 MB are allowed. Without Turso the object's own SQLite holds the same table, and the Bun dev server keeps them in memory.
- **The account load never touches them.** In Turso mode each account request loads every user table and writes it back, so `images` stays out of that set. The bytes sit behind their own async `ImageStore` (`server/src/account/images.ts`), which reads and writes one row at a time.
- **Format.** WebP where the browser can write it, else JPEG. Safari's canvas answers a WebP request with a PNG, and iOS has no WebP encoder, so both send JPEG. Re-encoding drops EXIF, location included, and applies its orientation first. The server checks the declared type against the first bytes and refuses anything else with `415`, and anything past the cap with `413`.

## Routes

- **Reading is in the agent contract; uploading is not.** `GET /api/images?id=&size=&space=` is `agentContract.images.get`, so AI accounts read images and the agent docs show an example. `PUT /api/images` takes raw bytes with the image's `Content-Type`, which the JSON contract does not describe, so it stays outside it, like the WebSockets. The Worker forwards both to the space's object. AI accounts cannot upload: the Worker refuses an AI on any route outside `SHARED_ROUTES`. Human guests upload with an edit share. Every host hands image requests to `AccountHandler.images` before the router.
- **The owner skips the queue.** The owner's image requests run outside the space's serial queue and never load the account: one row read or written. A guest's or an AI account's request loads the account in the queue, because only `scopeOf` over the owner's snapshot knows which tasks it may see. It reads an image only when a task it may see lists the id. It uploads with any edit share, since an upload reaches the server before the op that lists it, often for a task the server has not seen; the op itself still goes through `admit`.
- **Bytes are cached for good.** An id's bytes never change, so `GET` answers `Cache-Control: private, max-age=31536000, immutable`, and `PUT` of an existing id is a retry that keeps the stored bytes.
- **Public links show the row count, not the images.** A link viewer has no session, and the image routes need one.

## Order and offline

- **Bytes go before the edit that lists them.** Attaching encodes the image, writes both sizes to the device's upload queue and cache, and only then records the task edit. Each sync of a space uploads that space's queue first and pushes its outbox only after every upload succeeded. So the server never hears of an image it cannot serve, and an image added offline uploads on the first sync back online. A network failure stops that sync like any other. An upload the server refuses for good (`400`, `403`, `404`, `413`, `415`) is dropped so it cannot block sync.
- **Web keeps bytes in IndexedDB.** The stored document is synchronous `localStorage`, which must never hold bytes. `app-web/src/lib/images/local.ts` keeps a `bytes` store, the cache of every image this device made or fetched, and an `uploads` store, the queue with each image's space. A fetched image is cached there, so it shows offline afterwards.
- **iOS keeps the queue in Application Support and the cache in Caches.** The system may purge the cache, since everything in it can be fetched again. The queue is the only copy until it uploads.
- **A missing image waits.** When another device has not uploaded an image yet, the tile shows a placeholder and asks again every 30 seconds while it is on screen.
- **Bytes are written once.** A `PUT` of an id the server already holds keeps the stored bytes, so a guest with any edit share cannot swap the image behind an id it can only see. A request captured before its space's uploads is what the sync sends, so no edit in it lists an image still in the queue.
- **One gap is accepted.** An upload leaves the queue once the server has it. If the edit that lists it then fails to sync for longer than the two-day grace period, the sweep deletes the bytes, and the image stays a placeholder.
- **Switching users clears both.** Nothing of the previous user's stays on the device or uploads.

## Deleting

- **Deleting removes the id from the task.** There is no delete route. Bytes are garbage once no live task lists their id.
- **A sweep collects them after a grace period.** After a request that moved a space's log, at most once an hour per object, the server marks the rows no live task lists with `orphaned_at` and clears the mark of rows listed again. A row marked two days ago or more is deleted. The grace period covers undo, an offline device restoring a task, and an upload whose edit has not synced yet. A deleted task's tombstone lists nothing, so its images go too. Deleting the account deletes every row at once.

## Not built yet

- Images on public share links, attaching from the iOS share sheet or Shortcuts, per-item merging of the list, images on comments, and uploads by AI accounts.
