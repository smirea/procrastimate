# Task attachments

Task attachments let Stefan attach photos, screenshots, and any other file to a task. Task details show images as thumbnails and other files as tiles with an icon for their kind, their name, and their size; the row shows how many there are, a tap opens an image full screen or opens a file, and each can be deleted with undo. They sync to his other devices and to people the task is shared with, and an image added offline uploads once the device is back online.

## Sub-features

- `images-add` attaches images and files: the `Add attachment` tile's file picker (any file), a paste, or a drop onto details on the web; `Add attachment` then `Photo Library`, `Take Photo`, `Paste`, or `Choose File` on iOS, or a paste into the `Title` field. A tile pulses or spins while an image is being prepared.
- `images-quick-add` holds images and files in quick add until the task saves: the `Attachments` button (`Add attachment`, or `Add attachment, <n> added`) or the `+` menu's `Attachments`, a paste, or a drop on the web; the same button's `Photo Library`, `Take Photo`, and `Paste`, or a paste into `Task name`, on iOS. The `+` menu (`More quick add actions`) also lists `Camera`, which opens the camera straight away: on iOS devices with a camera, and on web touch screens through a `capture` file input. On both clients a draft with an attachment and no title enables `Add task` and saves as `Photo` (`<n> photos`), a lone file's name, or `<n> attachments`, from `attachmentsTitle` in `shared/format.ts` (`Format.attachmentsTitle` on iOS). The simulator's camera is replaced by a generated shot when launched with `PROCRASTIMATE_CAMERA_STUB=1`. They show under the title in `Attachments to add` as `Attachment <n> of <count>` (a file adds `, <name>` and shows its icon) with `Remove attachment <n>`, and attach after the save.
- `images-thumbs` shows each image as a square thumbnail in details, named `Open image <n> of <count>`, after the notes.
- `images-row` shows a photo icon with the count on the row, named `1 image` or `<n> images`; once any file is attached, a paperclip named `1 attachment` or `<n> attachments`.
- `files-tile` shows each other file as a tile named `Open <name>, <size>` (sizes like `82 KB`, `3.4 MB`), with an icon per kind (PDF, document, spreadsheet, presentation, archive, audio, video, image, code, text, other) tinted from the label palette. Web: a PDF, text, audio, video, or raster image opens in a new tab, anything else downloads under its name; the tile shows a spinner while its parts load. iOS: Quick Look. A file not yet uploaded toasts `<name> has not finished uploading`. Files over 25 MB toast `<name> is over 25 MB`.
- `files-delete` deletes a file with the tile's `Delete <name>` (hover on the web, context menu on iOS); the `Deleted file` toast's `Undo` puts it back.
- `images-viewer` opens an image full screen (dialog `Image` on the web): `Previous image` and `Next image` or the arrow keys on the web, swipes and pinch or double-tap zoom on iOS, `Close image` or Escape to leave, and on iOS a swipe down, which zooms back into the thumbnail.
- `images-delete` deletes the open image with `Delete image` (or the thumbnail's context menu on iOS); the `Deleted image` toast's `Undo` puts it back.
- `images-sync` shows an image on another device of the same account, and on a guest's device when the task is shared with them. A read-only task shows its images without the add tile or delete.
- `images-offline` keeps an image added offline on the device and uploads it, before the edit that lists it, when the network returns.

## How to get to it (user POV)

- Web: open a task's details. Choose the dashed `Add attachment` tile, paste an image or file anywhere in details, or drag files onto details, which shows `Drop to attach`.
- iOS: open a task's details and tap `Add attachment`, then `Photo Library`, `Take Photo` (devices with a camera), `Paste`, or `Choose File`.
- Both: tap a thumbnail to open it full screen.

## Driving it with control-ui and the simulator

Preconditions:

- The baseline state, with Inbox seeded with `Fix the fridge` through quick add.
- Automated web proof: `bun run test:e2e -- e2e/attachments.e2e.ts`.

- **Pick.** Open `Fix the fridge`, choose `Add attachment`, and pick a 3000 × 2000 photo. One `Open image 1 of 1` thumbnail appears, the row shows `1 image`, and the stored task lists the image at 2048 × 1365. Test: `an image picked in details shows as a thumbnail and on the row, opens full screen, and deletes with undo`.
- **View and delete.** Choose the thumbnail. The `Image` dialog shows it at 2048 wide. Escape closes only the viewer. Open it again and choose `Delete image`; the thumbnail and the row count go, and `Undo` brings both back. After a reload the thumbnail still shows. Same test.
- **Paste and drop.** In details, paste an image while the notes field has focus; it attaches and the notes stay empty. Drop an image file on details; a second thumbnail appears. Test: `images pasted or picked in quick add attach to the new task, and pasting or dropping into details adds more`.
- **Photo only.** Open quick add and pick one image through `+`, `Attachments`, typing nothing; `Add task` enables, and clicking it saves a task named `Photo` with `1 image`. Pick two and press Enter; it saves as `2 photos`. Test: `a quick add draft with images and no title saves named for them` in `e2e/attachments.e2e.ts`.
- **Quick add.** Open quick add, type `Paint swatches`, paste an image into `Task name`, and pick two more through `+`, `Attachments`. `Attachments to add` shows three; `Remove attachment 3` leaves two, and the title is unchanged. Press Enter; the row shows `2 images` and details show both thumbnails. Test: `images pasted or picked in quick add attach to the new task, and pasting or dropping into details adds more`.
- **Files.** On device A, pick a 3.2 MB `Minutes.txt`, a `Lease.pdf`, and a `photos.zip` in details. Three tiles show with the text, PDF, and archive icons, and the row reads `3 attachments`; the stored task lists each as `{ id, name, type, bytes }`. On device B, `Open Minutes.txt, 3.2 MB` opens a tab holding all 3,200,000 bytes, joined from three parts, and `Open photos.zip, 2 KB` downloads `photos.zip` byte for byte. Hover `Minutes.txt` on A and `Delete Minutes.txt`; `Undo` brings it back. Test: `files attach with their icon, name, and size, open or download on another device whole from their parts, and delete with undo`.
- **File only.** Drop `groceries.txt` on quick add with no title; `Attachment 1 of 1, groceries.txt` shows, and `Add task` saves a task named `groceries.txt` with `1 attachment`. Test: `a file dropped into quick add with no title saves named for it`.
- **Offline.** With two devices on one account, take device A offline, attach an image to a task there, and confirm device B's row shows no image. Bring A back online; B's row shows `1 image`, and B's details load a 320 px wide thumbnail from the server. Test: `an image added offline uploads when the network returns and shows on the other device`.
- **iOS.** Sign in to an account where the web attached an image to `Beach photos`. Its row reads `1 image`; details show the thumbnail, which opens full screen and closes with `Close image`. On `Fix the fridge`, `Add image`, `Photo Library`, and a photo attach `Open image 1 of 1`. Copy an image, then `Add image` and `Paste` attach `Open image 2 of 2` with no paste prompt; with no image copied, `Paste` is greyed out. Open it and `Delete image`; one thumbnail remains. Afterwards the server's task lists the photo library image. In quick add, copy an image, type a title, and choose `Paste` from the field's edit menu (no paste prompt); `Image 1 of 1` shows under the title and the title keeps its text. Save it; details show `Open image 1 of 1`. Paste into details' `Title`; `Open image 2 of 2` appears. Open an image and drag down; the viewer closes. A 4000 × 3000 paste shows its thumbnail about a second later without freezing. No automated iOS test is checked in; a throwaway `./sim test` file drove all of this.

## Gotchas

- A thumbnail shows a gray placeholder until its bytes arrive. Another device that has not uploaded yet keeps it gray, and the tile asks again 30 seconds later, so wait or reopen details.
- Safari and iOS store JPEG, Chromium stores WebP. Assert sizes, not the format.
- Headless Chromium downloads a PDF instead of showing it, so its new tab stays `about:blank`; prove the new-tab path with a text file.
- Every file part comes back from the server as `application/octet-stream` with `Content-Disposition: attachment`, by design.
- The web keeps images in IndexedDB, outside the synced database; clearing site data clears them, and they download again. It stores each as an `ArrayBuffer` with its type, because WebKit refuses a `Blob` in IndexedDB in a private window, as Playwright's WebKit contexts are.
- The web uploads every queued image at the start of each upload of queued writes, so a batch never names an image the server lacks.
- On iOS, an image picked offline stays in the upload queue until a sync reaches the server. Signing in as another user clears the queue.
