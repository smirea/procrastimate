# Task attachments

Tasks can hold images and any other file. Web attaches them from a file picker, a paste, or a drop onto task details or quick add. iOS attaches them from the photo library, the camera, or the pasteboard, in details and in quick add, and from a paste into the title field of either. Details show thumbnails, the row shows a count, a tap opens the image full screen, and an image can be deleted with undo. Any other file shows as a tile with an icon for its kind, its name, and its size, and opens or downloads on a tap.

## Files

- **One upload for everything.** The picker, paste, and drop take any file. An image a canvas (or `ImageEncoder` on iOS) can decode becomes an image, with its two encoded sizes; anything else, an SVG, or an image that fails to decode, is kept as the bytes it was picked as. There is no separate image upload and file upload.
- **A file ref says what the icon needs.** `FileRef` is `{ id, name, type, bytes }`. `type` is the MIME type the client reported, often empty. `fileKind` in `shared/images.ts` picks one of eleven kinds from the extension first, then the type, and `FILE_KIND_COLORS` tints each from the label palette so it has light and dark values on both clients. iOS mirrors the table in `Core/FileKinds.swift`, checked by the recorded vectors.
- **An untagged union.** A task's `attachments` holds `ImageRef | FileRef`, told apart by shape (`isImage` checks for `width`), because image refs synced before files existed carry no tag. Swift gets `enum Attachment { case image, file }` through `x-case-names`.
- **Parts, not one row.** A Durable Object row holds 2 MB, so a file is split into 1.5 MB parts (`FILE_PART_BYTES`), stored as rows `part0`, `part1`, and so on in the same `images` table, next to images' `full` and `thumb`. A file is at most 25 MB (17 parts). The sweep, upload queue, and guest checks treat a part like an image size, keyed by the attachment's id. A client reading a file fetches every part and checks the joined length against `bytes`; a short file has not finished uploading.
- **Opaque bytes, never rendered as uploaded.** The server stores and answers every part as `application/octet-stream` with `Content-Disposition: attachment` and `nosniff`, so a shared task's HTML file cannot run in the app's origin. The web opens a PDF, plain text, audio, video, or a raster image in a new tab, with a type it chose from the kind; everything else, HTML and SVG included, downloads under its name. The tab opens inside the click, before the bytes load, or the browser would block it. iOS shows files in Quick Look.
- **Names stay storage-era.** The task's TypeScript and Swift field is `attachments`, but its SQL column, the bytes table, and the route keep `images`; renaming them would have needed a data migration the additive schema does not have.

## Quick add

- **Images wait in the draft.** Quick add holds picked, pasted, or dropped images as the source bytes and shows them as small thumbnails under the title, each with a remove button. They attach only after the task is saved, through the same attach path details uses, so the bytes still go into the upload queue before the edit that lists them, and a task added offline uploads its images later. Encoding waits for the save, so an image removed from the draft costs nothing. The task's space is known only once it is saved, and the upload queue is keyed by space.
- **Camera in quick add's `+` menu.** The `+` menu at the end of the chip row lists `Camera` beside the attribute actions, on iOS only where `UIImagePickerController` reports a camera, and on the web only on touch screens, where its file input asks for `capture="environment"` so the phone opens the camera instead of a picker. The shot lands in the draft like any other image. It is a menu action, not a quick add button, so it has no chip to pin; `Images` still offers the camera among its sources. A long press on the tab bar's `+` was tried first and dropped: the camera belongs inside quick add, next to the other things a draft can carry.
- **A photo is enough to save.** On both clients, a draft holding images and no title saves as `Photo` (or `<n> photos`), a lone file as its name, and a mix as `<n> attachments` (`attachmentsTitle` in `shared/format.ts`), so snap and `Add task` is the whole capture; the title can be renamed later. Expanding into details keeps an untitled draft untitled, as before.
- **An `Attachments` button.** It is a quick add button like the others (`images` in `QUICK_ADD_BUTTONS`, the id kept so pinned rows survive), so it can be pinned and is always in the `+` menu. Its picker takes any file, and a drafted file shows as its icon and name. It is not in the default row. It shows on its own once the draft holds an image.

## Data

- **A task lists its attachments.** `tasks.attachments` (SQL column `images`) is a list of `ImageRef` `{ id, width, height }` and `FileRef` (`shared/values.ts`), one last-writer-wins field like `labelIds`. Two devices that add images to the same task offline keep one device's list, which [Sync](sync.md) already accepts for arrays. The id is a client-made UUID, so creating offline never collides. `width` and `height` let a client lay the image out before its bytes arrive.
- **Visibility is the task's.** Because the list is a task field, a guest syncs only the images of tasks its `access` rows name, and `admit` lets a guest change the list only on a task it may edit. There is no image kind to sync or scope. A task in a section follows its project's share, and its subtasks follow it, the same scope comments use.
- **Bytes never sync.** The bytes live in the server's `images` table, one row per size (`full` and `thumb`), keyed by user, id, and size, as a blob. The table is not one sync-engine syncs, so no client database ever holds them.

## Storage in the server's database

- **Rows small enough for a Durable Object.** A Durable Object row holds at most 2 MB. Clients scale the full image to 2048 px on its long side and the thumbnail to 320 px, then step the quality down until they fit 1.5 MB and 200 KB (`IMAGE_LIMITS` in `shared/images.ts`). One row holds one image, with no chunking. `server/src/images.ts` reads and writes one row at a time; nothing else ever selects the `bytes` column, so loading a space never carries them. Whether a task lists an image is a `json_each` over its `images`.
- **Format.** WebP where the browser can write it, else JPEG. Safari's canvas answers a WebP request with a PNG, and iOS has no WebP encoder, so both send JPEG. Re-encoding drops EXIF, location included, and applies its orientation first. The server checks the declared type against the first bytes and refuses anything else with `415`, and anything past the cap with `413`.

## Routes

- **Reading is in the agent contract; uploading is not.** `GET /api/images?id=&size=&space=` is `agentContract.images.get`, so AI accounts read images and the agent docs show an example. `PUT /api/images` takes raw bytes with the image's `Content-Type`, which the JSON contract does not describe, so it stays outside it, like the WebSocket. `server/src/api.ts` answers both before the router. The owner of the space reads and writes with one row read or written. A guest or an AI account reads its grants, then the image in one select that also checks a task it may see lists the id, found through the `tasks_images` GIN index (`jsonb_path_ops`) rather than a scan of the space: a human guest's `access` rows say which tasks those are, a manager sees them all, and any other AI account has the space's links loaded for `scopeOf` (`sightOf` in `server/src/space.ts`). It uploads with any edit share, since an upload reaches the server before the write that lists it, often for a task the server has not seen; the write itself still goes through `guestRefusal`.
- **Bytes are cached for good.** An id's bytes never change, so `GET` answers `Cache-Control: private, max-age=31536000, immutable`, and `PUT` of an existing id is a retry that keeps the stored bytes.
- **Public links show the row count, not the images.** A link viewer has no session, and the image routes need one.

## Pasting on iOS

- **A paste into a title field attaches the image.** SwiftUI's `TextEditor` takes an image paste but keeps only an attachment character (U+FFFC) and drops the image. `ImagePaste` is the paste delegate of every SwiftUI text view: the focused `SmartInput` claims it, and it takes the image items of the user's own paste before they reach the text, then hands them to the field's owner: quick add's draft or the task in details. The title never changes. Reading the image back from `UIPasteboard` afterwards showed the "Allow Paste" prompt, since only the paste's own items come without asking. `pasteDestination` never fires while the text view is first responder. Other smart inputs drop the character.
- **The image menu pastes through the system paste control.** The `Paste` item in details' and quick add's image menus is SwiftUI's `PasteButton` for image types, which works as a menu item. The user's tap on it grants access, so it shows no "Allow Paste" prompt and hands over the paste's item providers; a plain button reading `UIPasteboard` asked every time. It greys itself out while the pasteboard holds no image.
- **Nothing heavy on the main actor.** Pasted images are read as the bytes they were copied as, through the pasteboard's item providers, not through `UIPasteboard.images` and `jpegData`. Decoding and re-encoding a full-size photo on the main actor froze the app for 3 to 4 seconds (Sentry `PROCRASTIMATE-IOS-7`). `ImageEncoder` runs off it, and so do the camera's JPEG encode and quick add's thumbnails.

## Viewer

- **iOS zooms out of the thumbnail and swipes down to close.** The viewer is a full-screen cover with the zoom navigation transition from the tapped thumbnail, which also gives the system's interactive swipe-down dismiss, as in Photos.

## Order and offline

- **Bytes go before the edit that lists them.** Attaching encodes the image, writes both sizes to the device's upload queue and cache, and only then records the task edit. The engine's `beforePush` uploads every queued image, each to its own space, before a sync that carries writes (in the web's database worker, `app-web/src/lib/images/upload.ts`, and in iOS's `SyncClient`), and a failed upload fails that sync, so the writes wait for the retry. So the server never hears of an image it cannot serve, and an image added offline uploads on the first sync back online. An upload the server refuses for good (`400`, `403`, `404`, `413`, `415`) is dropped so it cannot block sync.
- **Where the clients keep them.** The web keeps a `bytes` cache and an `uploads` queue in IndexedDB, next to the database, each image as an `ArrayBuffer` with its type, because WebKit refuses a `Blob` in IndexedDB in a private window; the database worker reads the queue from there. iOS keeps the queue in Application Support and the cache in Caches, which the system may purge since everything in it can be fetched again. A fetched image is cached, so it shows offline afterwards.
- **A missing image waits.** When another device has not uploaded an image yet, the tile shows a placeholder and asks again every 30 seconds while it is on screen.
- **Bytes are written once.** A `PUT` of an id the server already holds keeps the stored bytes, so a guest with any edit share cannot swap the image behind an id it can only see.
- **One gap is accepted.** An upload leaves the queue once the server has it. If the edit that lists it then fails to sync for longer than the two-day grace period, the sweep deletes the bytes, and the image stays a placeholder.
- **Switching users clears both.** Nothing of the previous user's stays on the device or uploads.

## Deleting

- **Deleting removes the id from the task.** There is no delete route. Bytes are garbage once no live task lists their id.
- **A sweep collects them after a grace period.** The daily cron (`0 9 * * *`, after the backup) runs `sweepImages` over every user from two reads, the image rows and the tasks that list images: it marks the rows no live task lists with `orphaned_at` and clears the mark of rows listed again. A row marked two days ago or more is deleted. Nothing on the write path reads the `images` table. The grace period covers undo, an offline device restoring a task, and an upload whose edit has not synced yet. A deleted task's row is gone, so its images go too.

## Not built yet

- Attachments on public share links, attaching from the iOS share sheet or Shortcuts, per-item merging of the list, attachments on comments, uploads by AI accounts, files over 25 MB, and in-app previews of files on the web.
