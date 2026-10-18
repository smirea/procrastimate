# Task images

Tasks can hold images. Web attaches them from a file picker, a paste, or a drop onto task details. iOS attaches them from the photo library, the camera, or the pasteboard. Details show thumbnails, the row shows a count, a tap opens the image full screen, and an image can be deleted with undo.

## Data

- **A task lists its images.** `tasks.images` is a list of `{ id, width, height }` (`ImageRef` in `shared/values.ts`), one last-writer-wins field like `labelIds`. Two devices that add images to the same task offline keep one device's list, which [Sync](sync.md) already accepts for arrays. The id is a client-made UUID, so creating offline never collides. `width` and `height` let a client lay the image out before its bytes arrive.
- **Visibility is the task's.** Because the list is a task field, a guest syncs only the images of tasks its `access` rows name, and `admit` lets a guest change the list only on a task it may edit. There is no image kind to sync or scope. A task in a section follows its project's share, and its subtasks follow it, the same scope comments use.
- **Bytes never sync.** The bytes live in the server's `images` table, one row per size (`full` and `thumb`), keyed by user, id, and size, as `bytea`. The table is outside the PowerSync publication, so no client database ever holds them.

## Storage in Postgres

- **Rows small enough to serve from the Worker.** Clients scale the full image to 2048 px on its long side and the thumbnail to 320 px, then step the quality down until they fit 1.5 MB and 200 KB (`IMAGE_LIMITS` in `shared/images.ts`). One row holds one image, with no chunking. `server/src/images.ts` reads and writes one row at a time; nothing else ever selects the `bytes` column, so loading a space never carries them.
- **Format.** WebP where the browser can write it, else JPEG. Safari's canvas answers a WebP request with a PNG, and iOS has no WebP encoder, so both send JPEG. Re-encoding drops EXIF, location included, and applies its orientation first. The server checks the declared type against the first bytes and refuses anything else with `415`, and anything past the cap with `413`.

## Routes

- **Reading is in the agent contract; uploading is not.** `GET /api/images?id=&size=&space=` is `agentContract.images.get`, so AI accounts read images and the agent docs show an example. `PUT /api/images` takes raw bytes with the image's `Content-Type`, which the JSON contract does not describe, so it stays outside it, like the WebSocket. `server/src/api.ts` answers both before the router. The owner of the space reads and writes with one row read or written. A guest or an AI account reads its grants, then the image in one select that also checks a task it may see lists the id: a human guest's `access` rows say which tasks those are, a whole-space grant sees them all, and only an AI account with narrower grants has the tree loaded for `scopeOf` (`sightOf` in `server/src/space.ts`). It uploads with any edit share, since an upload reaches the server before the write that lists it, often for a task the server has not seen; the write itself still goes through `guestRefusal`.
- **Bytes are cached for good.** An id's bytes never change, so `GET` answers `Cache-Control: private, max-age=31536000, immutable`, and `PUT` of an existing id is a retry that keeps the stored bytes.
- **Public links show the row count, not the images.** A link viewer has no session, and the image routes need one.

## Order and offline

- **Bytes go before the edit that lists them.** Attaching encodes the image, writes both sizes to the device's upload queue and cache, and only then records the task edit. PowerSync's `uploadData` reads its batch of queued writes, then uploads every queued image, each to its own space, and posts the writes to `POST /api/upload` only after every image upload succeeded. A write is queued only after its image, so reading the batch first never misses one. So the server never hears of an image it cannot serve, and an image added offline uploads on the first sync back online. An upload the server refuses for good (`400`, `403`, `404`, `413`, `415`) is dropped so it cannot block sync.
- **Where the clients keep them.** The web keeps a `bytes` cache and an `uploads` queue in IndexedDB, next to the PowerSync database, each image as an `ArrayBuffer` with its type, because WebKit refuses a `Blob` in IndexedDB in a private window. iOS keeps the queue in Application Support and the cache in Caches, which the system may purge since everything in it can be fetched again. A fetched image is cached, so it shows offline afterwards.
- **A missing image waits.** When another device has not uploaded an image yet, the tile shows a placeholder and asks again every 30 seconds while it is on screen.
- **Bytes are written once.** A `PUT` of an id the server already holds keeps the stored bytes, so a guest with any edit share cannot swap the image behind an id it can only see.
- **One gap is accepted.** An upload leaves the queue once the server has it. If the edit that lists it then fails to sync for longer than the two-day grace period, the sweep deletes the bytes, and the image stays a placeholder.
- **Switching users clears both.** Nothing of the previous user's stays on the device or uploads.

## Deleting

- **Deleting removes the id from the task.** There is no delete route. Bytes are garbage once no live task lists their id.
- **A sweep collects them after a grace period.** The daily cron (`0 9 * * *`, after the backup) runs `sweepImages` over every user from two reads, the image rows and the tasks that list images: it marks the rows no live task lists with `orphaned_at` and clears the mark of rows listed again. A row marked two days ago or more is deleted. Nothing on the write path reads the `images` table. The grace period covers undo, an offline device restoring a task, and an upload whose edit has not synced yet. A deleted task's row is gone, so its images go too.

## Not built yet

- Images on public share links, attaching from the iOS share sheet or Shortcuts, per-item merging of the list, images on comments, and uploads by AI accounts.
